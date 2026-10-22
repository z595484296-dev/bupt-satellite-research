import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "center-flowus-cli-"));
const { FlowusCliClient } = await import("../server/flowus-cli-client.mjs");
const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const page = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const response = (data) => ({ stdout: JSON.stringify({ ok: true, data }) });
const options = {
  executable: path.resolve("test-flowus-binary"),
  configDir: path.resolve("test-flowus-profile"),
  workspaceId: workspace,
};
const identity = {
  workspace_id: workspace,
  capabilities: { "pages.read": true, "blocks.read": true },
};

test("CLI reader refuses writes and off-origin paths before launching a process", async () => {
  let calls = 0;
  const client = new FlowusCliClient({
    ...options,
    runner: async () => {
      calls++;
    },
  });
  for (const [route, body] of [
    ["https://evil.test", undefined],
    ["/pages/" + page, { title: "write" }],
    ["/blocks/" + page + "/children", {}],
    ["/users/me?redirect=evil", undefined],
  ])
    await assert.rejects(client.call(route, body), /不支持/);
  assert.equal(calls, 0);
});

test("CLI reads pin the workspace and isolate saved OAuth from ambient tokens", async () => {
  const calls = [];
  const oldToken = process.env.FLOWUS_TOKEN;
  process.env.FLOWUS_TOKEN = "must-not-reach-cli";
  try {
    const client = new FlowusCliClient({
      ...options,
      runner: async (exe, args, config) => {
        calls.push({ args, config });
        assert.equal(exe, options.executable);
        assert.equal(config.env.FLOWUS_TOKEN, undefined);
        assert.equal(config.env.FLOWUS_CONFIG_DIR, options.configDir);
        assert.equal(config.env.FLOWUS_BASE_URL, "https://api.flowus.cn");
        assert.equal(config.shell, false);
        return response(args[5] === "/v2/users/me" ? identity : { id: page });
      },
    });
    assert.equal((await client.call("/pages/" + page)).id, page);
    assert.equal((await client.call("/users/me")).workspace_id, workspace);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args[4], "GET");
  } finally {
    if (oldToken === undefined) delete process.env.FLOWUS_TOKEN;
    else process.env.FLOWUS_TOKEN = oldToken;
  }
  let calls2 = 0;
  const wrong = new FlowusCliClient({
    ...options,
    runner: async () => {
      calls2++;
      return response({ workspace_id: "other" });
    },
  });
  await assert.rejects(wrong.call("/pages/" + page), /空间与网站配置不一致/);
  assert.equal(calls2, 1);
});

test("CLI queries preserve pagination and clean temporary bodies on failure", async () => {
  const requestDir = await mkdtemp(path.join(tmpdir(), "flowus-query-body-"));
  const bodies = [];
  let fail = false;
  const client = new FlowusCliClient({
    ...options,
    requestDir,
    runner: async (_exe, args) => {
      if (args[5] === "/v2/users/me") return response(identity);
      assert.equal(args[4], "POST");
      const body = JSON.parse(
        await readFile(args[args.indexOf("--body") + 1], "utf8"),
      );
      bodies.push(body);
      if (fail)
        throw Object.assign(new Error("SECRET must not escape"), {
          stdout: JSON.stringify({
            error: { code: "unauthorized", message: "SECRET" },
          }),
        });
      return response(
        body.start_cursor
          ? { results: [{ id: "second" }], has_more: false }
          : {
              results: [{ id: "first" }],
              has_more: true,
              next_cursor: "cursor two",
            },
      );
    },
  });
  assert.equal(
    (await client.list("/databases/" + page + "/query", {})).length,
    2,
  );
  assert.equal(bodies[1].start_cursor, "cursor two");
  assert.deepEqual(await readdir(requestDir), []);
  fail = true;
  await assert.rejects(
    client.call("/databases/" + page + "/query", {}),
    (e) => !e.message.includes("SECRET") && e.message.includes("授权失效"),
  );
  assert.deepEqual(await readdir(requestDir), []);
});

test("CLI GET pagination passes cursors as separate arguments", async () => {
  const client = new FlowusCliClient({
    ...options,
    runner: async (_exe, args) => {
      if (args[5] === "/v2/users/me") return response(identity);
      if (args.includes("start_cursor=cursor & two"))
        return response({ results: [], has_more: false });
      return response({
        results: [{ id: page }],
        has_more: true,
        next_cursor: "cursor & two",
      });
    },
  });
  assert.equal((await client.list("/blocks/" + page + "/children")).length, 1);
});

test("service recognizes CLI authorization without pretending a token is stored", async () => {
  const { initStorage } = await import("../server/storage.mjs");
  const { createFlowusService } = await import("../server/flowus-service.mjs");
  await initStorage();
  Object.assign(process.env, {
    FLOWUS_AUTH_MODE: "cli",
    FLOWUS_CLI_PATH: options.executable,
    FLOWUS_CONFIG_DIR: options.configDir,
    FLOWUS_WORKSPACE_ID: workspace,
  });
  const service = await createFlowusService({
    clientFactory: () => ({
      call: async () => ({ ...identity, workspace_name: "Test workspace" }),
    }),
  });
  try {
    const status = await service.status();
    assert.equal(status.config.hasConnection, true);
    assert.equal(status.config.hasToken, false);
    assert.equal(status.config.tokenSource, "cli");
    assert.equal((await service.connection()).workspace, "Test workspace");
    assert.ok(!JSON.stringify(status).includes(options.configDir));
  } finally {
    service.close();
    for (const key of [
      "FLOWUS_AUTH_MODE",
      "FLOWUS_CLI_PATH",
      "FLOWUS_CONFIG_DIR",
      "FLOWUS_WORKSPACE_ID",
    ])
      delete process.env[key];
  }
});
