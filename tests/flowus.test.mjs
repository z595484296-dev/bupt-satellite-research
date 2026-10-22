import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "center-flowus-"));
process.env.DATA_DIR = root;
delete process.env.FLOWUS_TOKEN;
const { initStorage, readData, mutateData } =
  await import("../server/storage.mjs");
const { FlowusClient, resolveAsset, publicAddress } =
  await import("../server/flowus-client.mjs");
const { preparePage } = await import("../server/flowus-content.mjs");
const { createFlowusService, publicContent, validateConfig } =
  await import("../server/flowus-service.mjs");
await initStorage();
const id = "8f3f1d4a-8af8-4a4d-ab1e-ea8ba0896927";
const db = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const imageId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfNQAAAAASUVORK5CYII=",
  "base64",
);
const pdf = Buffer.from("%PDF-1.7\nfixture document\n%%EOF");
const rt = (value) => [
  { type: "text", text: { content: value }, plain_text: value },
];
let markdown =
  "## 测试正文\n\n这是一段 **加粗内容**。\n\n![配图](https://cdn.example.org/image.png?token=temporary)\n\n[报告](https://cdn.example.org/report.pdf?token=temporary)\n\n|项目|说明|\n|---|---|\n|卫星|连接|";
let page = {
  id,
  last_edited_time: "2026-10-18T00:00:00Z",
  in_trash: false,
  parent: { database_id: db },
  properties: {
    title: { type: "title", title: rt("同步测试文章") },
    官网发布: { type: "checkbox", checkbox: true },
  },
};
let fail = false,
  mediaFail = false;
const fake = {
  async call(route) {
    if (fail) throw Object.assign(new Error("模拟连接失败"), { status: 502 });
    if (route === "/users/me")
      return {
        workspace_name: "测试空间",
        capabilities: {
          "pages.read": true,
          "blocks.read": true,
          "databases.read": true,
        },
      };
    if (route.endsWith("/content/markdown"))
      return { markdown, last_edited_time: page.last_edited_time };
    if (route === "/pages/" + id) return structuredClone(page);
    throw new Error("Unexpected request " + route);
  },
  async list(route) {
    if (fail) throw Object.assign(new Error("模拟连接失败"), { status: 502 });
    if (route.includes("/query")) return [structuredClone(page)];
    if (route === `/blocks/${id}/children`)
      return [
        {
          id: imageId,
          type: "image",
          image: {
            external: {
              url: "https://cdn.example.org/image.png?token=rotated",
            },
            caption: rt("配图"),
          },
        },
        {
          id: fileId,
          type: "file",
          file: {
            external: {
              url: "https://cdn.example.org/report.pdf?token=rotated",
            },
            caption: rt("研究报告.pdf"),
          },
        },
      ];
    throw new Error("Unexpected children " + route);
  },
};
const download = async (url) => {
  if (mediaFail)
    throw Object.assign(new Error("模拟附件失败"), { status: 422 });
  return url.includes("image") ? png : pdf;
};

test("FlowUs API uses only official origin, paginates and retries without leaking credentials", async () => {
  const calls = [];
  let count = 0;
  const client = new FlowusClient("private-test-token", {
    interval: 0,
    sleep: async () => {},
    fetcher: async (url, options) => {
      calls.push({ url, options });
      count++;
      if (count === 1)
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      return Response.json(
        count === 2
          ? { results: [{ id: "a" }], has_more: true, next_cursor: "page 2" }
          : { results: [{ id: "b" }], has_more: false },
      );
    },
  });
  const results = await client.list(`/blocks/${id}/children`);
  assert.deepEqual(
    results.map((x) => x.id),
    ["a", "b"],
  );
  assert.ok(
    calls.every(
      (c) =>
        c.url.startsWith("https://api.flowus.cn/v2/") &&
        c.options.redirect === "error",
    ),
  );
  assert.ok(calls[2].url.includes("page%202"));
  await assert.rejects(client.call("//evil.test"), /不支持/);
  const forbidden = new FlowusClient("secret", {
    interval: 0,
    sleep: async () => {},
    fetcher: async () => new Response("echo-secret", { status: 403 }),
  });
  await assert.rejects(
    forbidden.call("/users/me"),
    (e) => !e.message.includes("secret") && e.message.includes("权限"),
  );
});

test("media SSRF policy blocks local, mixed DNS, encoded IPs and unsafe protocols", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "100.64.1.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  for (const url of [
    "http://public.example/a",
    "https://127.1/a",
    "https://2130706433/a",
    "https://[::1]/a",
    "https://a:b@public.example/a",
    "https://public.example:8443/a",
  ])
    await assert.rejects(resolveAsset(url));
  await assert.rejects(
    resolveAsset("https://public.example/a", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
  );
  assert.equal(
    (
      await resolveAsset("https://public.example/a", async () => [
        { address: "8.8.8.8", family: 4 },
      ])
    ).address.address,
    "8.8.8.8",
  );
});

test("body, signed-image URLs and attachment blocks become safe local website content", async () => {
  const prepared = await preparePage({
    client: fake,
    page,
    stageDir: path.join(root, "prepare"),
    download,
  });
  assert.equal(prepared.issues.length, 0);
  assert.equal(prepared.assets.length, 2);
  assert.equal(prepared.attachments.length, 1);
  assert.match(prepared.body, /\/media\/[a-f0-9]{64}\.png/);
  assert.ok(
    !prepared.body.includes("temporary") &&
      !prepared.body.includes("cdn.example"),
  );
  assert.match(prepared.body, /\| 项目/);
  assert.equal(prepared.attachments[0].name, "研究报告.pdf");
});

test("automatic sync, stable IDs, failures, withdrawal and private preview lifecycle", async (t) => {
  const service = await createFlowusService({
    clientFactory: () => fake,
    download,
  });
  t.after(() => service.close());
  const cfg = {
    sources: [
      { id: db, type: "database", kind: "insight", publishField: "官网发布" },
    ],
    autoPublish: true,
    intervalMinutes: 0,
    token: "fixture-secret",
  };
  const run = async () => {
    await service.run();
    for (let i = 0; i < 200; i++) {
      const st = await service.status();
      if (!st.running) return st;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("sync did not finish");
  };
  await service.configure(cfg);
  assert.ok(!JSON.stringify(await service.status()).includes("fixture-secret"));
  assert.equal((await service.connection()).workspace, "测试空间");
  const before = await readData("content.json");
  let st = await run();
  assert.equal(st.lastRun.published, 1, JSON.stringify(st.lastRun));
  let content = await readData("content.json");
  const entry = content.entries.find((e) => e.flowus?.pageId === id);
  assert.equal(entry.id, "spacex-commercialization");
  assert.equal(content.entries.length, before.entries.length);
  assert.ok(entry.body.includes("/media/"));
  assert.equal(
    entry.featured,
    before.entries.find((e) => e.id === entry.id).featured,
  );
  assert.equal(entry.attachments.length, 1);
  assert.ok(publicContent(content).entries.every((e) => !("flowus" in e)));
  assert.deepEqual(await readdir(path.join(root, "flowus-staging")), []);
  st = await run();
  assert.equal(st.lastRun.unchanged, 1);
  assert.equal((await readData("content.json")).version, content.version);

  fail = true;
  st = await run();
  fail = false;
  assert.equal(st.lastRun.errors.length, 1);
  assert.deepEqual(await readData("content.json"), content);
  mediaFail = true;
  st = await run();
  mediaFail = false;
  assert.equal(st.lastRun.errors.length, 1);
  assert.deepEqual(await readData("content.json"), content);

  markdown += "\n\n<!-- unsupported chart -->";
  st = await run();
  assert.equal(st.candidates.length, 1);
  assert.ok(st.candidates[0].issues.length > 0);
  assert.deepEqual(await readData("content.json"), content);
  const blocked = st.candidates[0];
  const f = blocked.assets[0].url.split("/").at(-1);
  assert.ok(
    (await readFile(await service.previewFile(blocked.revision, f))).length > 0,
  );
  await assert.rejects(service.previewFile(blocked.revision, "../secret"));
  await assert.rejects(service.approve(blocked.revision), /问题/);
  markdown = markdown.replace("\n\n<!-- unsupported chart -->", "");

  page.properties["官网发布"].checkbox = false;
  st = await run();
  assert.equal(st.lastRun.withdrawn, 1);
  assert.equal(
    publicContent(await readData("content.json")).entries.some(
      (e) => e.id === entry.id,
    ),
    false,
  );
  assert.equal(st.candidates.length, 0);
  page.properties["官网发布"].checkbox = true;
  st = await run();
  assert.equal(st.lastRun.published, 1);

  await service.configure({ ...cfg, autoPublish: false });
  markdown += "\n\n新增的段落。";
  st = await run();
  assert.equal(st.candidates.length, 1);
  assert.ok(
    !(await readData("content.json")).entries
      .find((e) => e.id === entry.id)
      .body.includes("新增"),
  );
  const pending = st.candidates[0];
  await mutateData("content.json", (old) => ({
    ...old,
    version: old.version + 1,
    entries: old.entries.map((e) =>
      e.id === entry.id ? { ...e, summary: "管理员修改" } : e,
    ),
  }));
  await assert.rejects(service.approve(pending.revision), /已被修改/);
  st = await run();
  await service.approve(st.candidates[0].revision);
  assert.ok(
    (await readData("content.json")).entries
      .find((e) => e.id === entry.id)
      .body.includes("新增"),
  );
  await assert.rejects(service.approve(pending.revision), /过期/);
  await service.configure({
    ...cfg,
    sources: [{ id, type: "page", kind: "insight" }],
  });
  page.in_trash = true;
  st = await run();
  // A differently configured source cannot retract content it does not own.
  assert.equal(st.lastRun.withdrawn, 0);
  page.in_trash = false;
});

test("source configuration requires an explicit bounded source and cannot accept arbitrary hosts", () => {
  assert.throws(() => validateConfig({ sources: [] }), /来源/);
  assert.throws(
    () =>
      validateConfig({
        sources: [
          { id: "https://evil.test/" + id, type: "page", kind: "insight" },
        ],
        intervalMinutes: 5,
      }),
    /FlowUs/,
  );
  assert.equal(
    validateConfig({
      sources: [
        {
          id: "https://flowus.cn/ithinker/share/" + id,
          type: "page",
          kind: "insight",
        },
      ],
      intervalMinutes: 5,
    }).autoPublish,
    true,
  );
});

test("directory discovery identifies sources without publishing the directory", async (t) => {
  const client = {
    ...fake,
    async list(route) {
      if (route === `/blocks/${id}/children`)
        return [
          {
            id: db,
            type: "child_database",
            child_database: { title: "中心观点" },
          },
          { id: fileId, type: "child_page", child_page: { title: "中心简介" } },
        ];
      throw new Error("Unexpected traversal");
    },
  };
  const service = await createFlowusService({
    clientFactory: () => client,
    download,
  });
  t.after(() => service.close());
  await service.configure({
    discoveryRoot: id,
    sources: [],
    token: "fixture-key",
    autoPublish: true,
    intervalMinutes: 0,
  });
  const result = await service.discover();
  assert.deepEqual(
    result.sources.map((x) => [x.type, x.title]),
    [
      ["database", "中心观点"],
      ["page", "中心简介"],
    ],
  );
  assert.equal((await service.status()).config.sources.length, 0);
});

test("HTTP delivery protects pending media and revokes synchronized files on unpublish", async (t) => {
  const revision = "33333333-3333-4333-8333-333333333333";
  const filename = "a".repeat(64) + ".png";
  await mkdir(path.join(root, "flowus-staging", revision), { recursive: true });
  await writeFile(path.join(root, "flowus-staging", revision, filename), png);
  await writeFile(path.join(root, "uploads", filename), png);
  await mutateData("flowus-state.json", (st) => ({
    ...st,
    candidates: [
      { revision, pageId: id, assets: [{ url: "/media/" + filename }] },
    ],
  }));
  const proc = spawn(process.execPath, ["server/index.mjs", "--production"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: root,
      RUNTIME_DIR: path.join(root, "runtime"),
      PORT: "0",
      HOST: "127.0.0.1",
      ADMIN_PASSWORD: "test-only-http-password",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (proc.exitCode === null) {
      const done = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await done;
    }
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("server timeout")), 10000);
    proc.stdout.on("data", (b) => {
      output += b;
      const match = output.match(/Website ready: (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    proc.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("server exited"));
    });
  });
  const media = "/api/admin/flowus/media/" + revision + "/" + filename;
  assert.equal((await fetch(url + media)).status, 401);
  assert.equal((await fetch(url + "/media/" + filename)).status, 404);
  const login = await fetch(url + "/api/admin/login", {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "test-only-http-password",
    }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await fetch(url + media, { headers: { Cookie: cookie } })).status,
    200,
  );
  let content = await (
    await fetch(url + "/api/admin/content", { headers: { Cookie: cookie } })
  ).json();
  let entry = content.entries.find((e) => e.flowus?.pageId === id);
  const attachment = entry.attachments[0].url;
  const file = await fetch(url + attachment);
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-disposition"), /attachment/);
  const save = async (status) => {
    const r = await fetch(url + "/api/admin/entries", {
      method: "POST",
      headers: {
        Origin: url,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: content.version,
        entry: { ...entry, status },
      }),
    });
    assert.equal(r.status, 200);
    content = await r.json();
    entry = content.entries.find((e) => e.id === entry.id);
  };
  await save("draft");
  assert.equal((await fetch(url + attachment)).status, 404);
  await save("published");
  assert.equal((await fetch(url + attachment)).status, 200);
});
