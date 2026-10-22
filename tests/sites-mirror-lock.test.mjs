import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('manual and scheduled mirror runs share one lock while checking FlowUs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'center-mirror-lock-'));
  process.env.DATA_DIR = dir;
  process.env.SITES_MIRROR_URL = 'https://lock-test.chatgpt.site';
  process.env.SITES_SYNC_TOKEN = 'test-only';
  process.env.SITES_ACCESS_TOKEN = 'test-only';
  const { createSitesMirror } = await import('../server/sites-mirror.mjs');
  let release, checks = 0;
  const busy = new Promise(resolve => { release = resolve; });
  const mirror = createSitesMirror({ flowusBusy: () => { checks++; return busy; } });
  try {
    const first = mirror.run();
    assert.equal((await mirror.run()).running, true);
    assert.equal(checks, 1);
    release(true);
    assert.equal((await first).running, false);
    assert.equal((await mirror.status()).running, false);
  } finally {
    mirror.close();
    await rm(dir, { recursive: true, force: true });
  }
});
