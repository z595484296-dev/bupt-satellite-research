import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const origin = 'http://127.0.0.1:3000';
const mediaPath = /\/media\/[a-f0-9-]+\.(?:png|jpg|webp|gif|avif|pdf|docx|xlsx|pptx)\b/g;
const fileLimit = 32 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function readPublic(path, limit) {
  const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Public source HTTP ' + response.status);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error('Public source exceeds the Sites size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

// Installed as a forced command for a dedicated SSH key. Only the public HTTP
// service is consulted, including when deciding whether a media file is in scope.
export async function exportPublic(command, read = readPublic) {
  const content = JSON.parse(await read('/api/content', 2_000_000));
  if (!content.settings || !Number.isSafeInteger(content.version) || !Array.isArray(content.entries) ||
      content.entries.some(e => e.status !== 'published' || e.flowus)) {
    throw new Error('Unexpected public content');
  }
  if (command === 'content') return Buffer.from(JSON.stringify(content));
  const urls = new Set(JSON.stringify(content).match(mediaPath) || []);
  if (urls.size > 2000) throw new Error('Too many published files');
  if (command.startsWith('media ') && urls.has(command.slice(6))) {
    return read(command.slice(6), fileLimit);
  }
  if (command !== 'manifest') throw new Error('Unknown command or unpublished media');
  const files = [];
  for (const url of urls) {
    const bytes = await read(url, fileLimit);
    if (!bytes.length) throw new Error('Empty published file');
    files.push({ url, size: bytes.length, hash: sha(bytes) });
  }
  const digest = sha(JSON.stringify({ content, files }));
  return Buffer.from(JSON.stringify({ content, files, digest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(await exportPublic(process.env.SSH_ORIGINAL_COMMAND || ''));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
