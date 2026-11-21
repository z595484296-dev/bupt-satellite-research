import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { exportPublic } from '../deploy/aliyun/sites-public-export.mjs';
import { syncPublished } from '../scripts/sync-sites-content.mjs';

const url = '/media/abcd-1234.jpg';
const bytes = Buffer.from('fixture image');
const sourceContent = { version: 7, settings: { name: '站点' },
  entries: [{ id: 'article', status: 'published', body: '![图](' + url + ')' }] };
const previous = { ...sourceContent, version: 6, entries: [{ id: 'old', status: 'published' }] };
function source(command) {
  return exportPublic(command, async path => {
    if (path === '/api/content') return Buffer.from(JSON.stringify(sourceContent));
    assert.equal(path, url);
    return bytes;
  });
}

test('export only public content and referenced files', async () => {
  const manifest = JSON.parse(await source('manifest'));
  assert.deepEqual(manifest.content, sourceContent);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].hash, createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(source('media /media/abcd-ffff.jpg'));
  await assert.rejects(source('media /api/admin/flowus'));
  await assert.rejects(exportPublic('manifest', async () => JSON.stringify({
    ...sourceContent, entries: [{ status: 'draft' }],
  })));
});

function destination() {
  let live = previous;
  let digest = 'old';
  let uploaded = false;
  const writes = [];
  async function request(path, data, hash) {
    if (path === '/api/content') return live;
    if (path === '/api/sync/prepare') return { digest, missing: uploaded ? [] : [url] };
    if (path === '/api/sync' + url) {
      assert.equal(hash, createHash('sha256').update(data).digest('hex'));
      uploaded = true;
    } else {
      assert.equal(path, '/api/sync/commit');
      assert.ok(uploaded);
      live = data.content;
      digest = data.digest;
    }
    writes.push(path);
    return { ok: true, digest };
  }
  return { request, writes };
}

test('upload before publication, remove withdrawn items, rerun without writing', async () => {
  const { request, writes } = destination();
  assert.equal((await syncPublished(source, request)).uploaded, 1);
  assert.deepEqual(await request('/api/content'), sourceContent);
  assert.equal((await syncPublished(source, request)).uploaded, 0);
  assert.deepEqual(writes, ['/api/sync' + url, '/api/sync/commit']);
});

test('changed source or incorrect media cannot commit', async () => {
  for (const failure of ['media', 'content']) {
    const { writes, request } = destination();
    const unstable = command => {
      if (failure === 'media' && command.startsWith('media ')) return Buffer.from('changed');
      if (failure === 'content' && command === 'content') return Buffer.from(JSON.stringify(previous));
      return source(command);
    };
    await assert.rejects(syncPublished(unstable, request), /changed/);
    assert.ok(!writes.includes('/api/sync/commit'));
  }
});
