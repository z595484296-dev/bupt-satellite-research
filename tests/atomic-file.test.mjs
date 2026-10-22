import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicWriteJson } from "../server/atomic-file.mjs";

test("temporary Windows locks preserve the readable old version and retry the atomic replacement", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "center-atomic-"));
  const file = path.join(dir, "data.json");
  try {
    await writeFile(file, JSON.stringify({ version: 1 }));
    let attempts = 0;
    await atomicWriteJson(
      file,
      { version: 2 },
      {
        replace: async (from, to) => {
          assert.equal(JSON.parse(await readFile(file)).version, 1);
          if (++attempts < 3)
            throw Object.assign(new Error("file is busy"), { code: "EPERM" });
          await rename(from, to);
        },
      },
    );
    assert.equal(attempts, 3);
    assert.equal(JSON.parse(await readFile(file)).version, 2);
    assert.deepEqual(await readdir(dir), ["data.json"]);
    let permanentAttempts = 0;
    await assert.rejects(
      atomicWriteJson(
        file,
        { version: 3 },
        {
          replace: async () => {
            permanentAttempts++;
            throw Object.assign(new Error("storage unavailable"), {
              code: "ENOSPC",
            });
          },
        },
      ),
      { code: "ENOSPC" },
    );
    assert.equal(permanentAttempts, 1);
    assert.equal(JSON.parse(await readFile(file)).version, 2);
    assert.deepEqual(await readdir(dir), ["data.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
