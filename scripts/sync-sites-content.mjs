import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const site = 'https://bupt-satellite-research.tongjian.chatgpt.site';
const mediaPath = /^\/media\/[a-f0-9-]+\.(?:png|jpg|webp|gif|avif|pdf|docx|xlsx|pptx)$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function syncPublished(source, request) {
  const snapshot = JSON.parse(await source('manifest'));
  const { content, files, digest } = snapshot;
  if (sha(JSON.stringify({ content, files })) !== digest) throw new Error('Invalid source digest');
  const manifest = new Map(files.map(file => [file.url, file]));
  const prepare = () => request('/api/sync/prepare', { files });
  const current = await prepare();
  for (const url of current.missing) {
    const file = manifest.get(url);
    if (!file || !mediaPath.test(url)) throw new Error('Unexpected media request');
    const bytes = await source('media ' + url);
    if (bytes.length !== file.size || sha(bytes) !== file.hash) throw new Error('Media changed during transfer');
    await request('/api/sync' + url, bytes, file.hash);
  }
  if (current.digest !== digest || current.missing.length) {
    const ready = await prepare();
    if (ready.missing.length || (ready.digest !== current.digest && ready.digest !== digest)) {
      throw new Error('Destination changed; retry with a new snapshot');
    }
    const latest = JSON.parse(await source('content'));
    if (!isDeepStrictEqual(latest, content)) throw new Error('Source changed; retry with a new snapshot');
    if (ready.digest !== digest) {
      const saved = await request('/api/sync/commit', snapshot);
      if (!saved.ok || saved.digest !== digest) throw new Error('Commit not confirmed');
    }
  }
  const published = await request('/api/content');
  if (!isDeepStrictEqual(published, content)) throw new Error('Public content verification failed');
  return { version: content.version, entries: content.entries.length, files: files.length, uploaded: current.missing.length };
}

async function run() {
  const { ALIYUN_HOST: host, SITES_SYNC_TOKEN: token, SSH_KEY_FILE, SSH_HOSTS_FILE } = process.env;
  if (!host || !/^[a-z0-9][a-z0-9.-]*$/i.test(host) || !token || !SSH_KEY_FILE || !SSH_HOSTS_FILE) {
    throw new Error('Missing or invalid mirror configuration');
  }
  const execute = promisify(execFile);
  const sshArgs = ['-T', '-i', SSH_KEY_FILE, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + SSH_HOSTS_FILE,
    '-o', 'ConnectTimeout=15', 'satellite-reader@' + host];
  async function source(command) {
    const result = await execute('ssh', [...sshArgs, command], { encoding: 'buffer', timeout: 180000, maxBuffer: 34 * 1024 * 1024 });
    return result.stdout;
  }
  async function request(path, data, hash) {
    const headers = {};
    if (data !== undefined) {
      headers['X-Center-Sync'] = token;
      headers['Content-Type'] = hash ? 'application/octet-stream' : 'application/json';
      if (hash) headers['X-Content-SHA256'] = hash;
    }
    const response = await fetch(site + path, {
      method: hash ? 'PUT' : data === undefined ? 'GET' : 'POST', headers, redirect: 'error',
      body: data === undefined ? undefined : hash ? data : JSON.stringify(data), signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error('Sites returned HTTP ' + response.status);
    return response.json();
  }
  console.log(await syncPublished(source, request));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
