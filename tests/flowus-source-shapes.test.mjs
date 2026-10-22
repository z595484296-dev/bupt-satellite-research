import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "center-flowus-shapes-"),
);
delete process.env.FLOWUS_TOKEN;
delete process.env.FLOWUS_AUTH_MODE;
const { initStorage, readData } = await import("../server/storage.mjs");
const { preparePage, property } = await import("../server/flowus-content.mjs");
const { createFlowusService } = await import("../server/flowus-service.mjs");
await initStorage();
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const draftId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const db = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rt = (text) => [{ plain_text: text }];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfNQAAAAASUVORK5CYII=",
  "base64",
);

test("FlowUs multi-select authors and slash dates retain actual source metadata", () => {
  const page = {
    properties: {
      作者: { multi_select: [{ name: "甲" }, { name: "乙" }] },
      时间: { date: { start: "2026/08/04T00:00:00" } },
    },
  };
  assert.equal(property(page, "作者"), "甲、乙");
  assert.equal(property(page, "时间"), "2026-08-04");
});

test("OSS-only image blocks resolve from the matching Markdown export, with ordinary HTTP citations preserved", async () => {
  const markdown =
    "正文\n\n![](https://cdn2.flowus.cn/oss/approved/%E5%9B%BE.png?token=temporary)\n\n来源：http://example.org/news";
  const client = {
    call: async () => ({ markdown }),
    list: async () => [
      {
        type: "image",
        image: { type: "file", file: { oss_name: "oss/approved/图.png" } },
      },
    ],
  };
  const result = await preparePage({
    client,
    page: { id },
    stageDir: path.join(process.env.DATA_DIR, "image"),
    download: async (url) => {
      assert.match(url, /^https:\/\/cdn2\.flowus\.cn\/oss\/approved\//);
      return png;
    },
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.assets.length, 1);
  assert.ok(result.body.includes("/media/") && !result.body.includes("token="));
  assert.ok(result.body.includes("http://example.org/news"));
});

test("an unavailable attachment stops publication instead of silently dropping the file", async () => {
  const client = {
    call: async () => ({ markdown: "需要附件的文章。" }),
    list: async () => [],
  };
  const page = {
    id,
    properties: {
      附件: {
        type: "files",
        files: [
          {
            name: "研究报告.pdf",
            file: { oss_name: "oss/private/report.pdf" },
          },
        ],
      },
    },
  };
  const result = await preparePage({
    client,
    page,
    stageDir: path.join(process.env.DATA_DIR, "missing-file"),
    download: async () => {
      assert.fail("No downloadable address was provided");
    },
  });
  assert.deepEqual(result.assets, []);
  assert.match(result.issues.join(" "), /附件未返回下载地址/);
});

test("a publication status excludes drafts, follows new records and retracts records removed from the status", async () => {
  let state = "研究中心",
    fieldValid = true;
  const make = (pageId, name) => ({
    id: pageId,
    parent: { database_id: db },
    properties: {
      title: { type: "title", title: rt(name) },
      状态: fieldValid
        ? { type: "select", select: { name: pageId === id ? state : "写作中" } }
        : { type: "rich_text", rich_text: rt(state) },
    },
  });
  let bodyReads = 0;
  const client = {
    call: async (route) => {
      if (route.endsWith("/content/markdown")) {
        bodyReads++;
        return { markdown: "公开正文。" };
      }
      if (route === "/pages/" + id) return make(id, "已确认公开的观点");
      throw new Error("unexpected route");
    },
    list: async (route) =>
      route.endsWith("/query")
        ? [make(id, "已确认公开的观点"), make(draftId, "内部草稿")]
        : [],
  };
  const service = await createFlowusService({ clientFactory: () => client });
  const run = async () => {
    await service.run();
    for (let n = 0; n < 200; n++) {
      const s = await service.status();
      if (!s.running) return s.lastRun;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("sync timeout");
  };
  try {
    await service.configure({
      sources: [
        {
          id: db,
          type: "database",
          kind: "insight",
          publishField: "状态",
          publishValue: "研究中心",
        },
      ],
      token: "fixture-only",
      autoPublish: true,
      intervalMinutes: 0,
    });
    assert.equal((await run()).published, 1);
    assert.equal(bodyReads, 1);
    assert.equal(
      (await readData("content.json")).entries.some(
        (e) => e.flowus?.pageId === draftId,
      ),
      false,
    );
    fieldValid = false;
    const malformed = await run();
    assert.ok(malformed.errors.length);
    assert.equal(
      (await readData("content.json")).entries.find(
        (e) => e.flowus?.pageId === id,
      ).status,
      "published",
    );
    fieldValid = true;
    state = "写作中";
    const withdrawal = await run();
    assert.equal(withdrawal.withdrawn, 1, JSON.stringify(withdrawal));
    assert.equal(
      (await readData("content.json")).entries.find(
        (e) => e.flowus?.pageId === id,
      ).status,
      "draft",
    );
    assert.deepEqual(
      await readdir(path.join(process.env.DATA_DIR, "flowus-staging")),
      [],
    );
  } finally {
    service.close();
  }
});

test("news scope matches an exact multi-select tag, preserves mixed tags, and retracts removed tags", async () => {
  const newsDb = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const newsId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const excludedId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  let tags = ["中心动态", "线上访谈"];
  let validField = true;
  let bodyReads = 0;
  const make = (pageId, names) => ({
    id: pageId,
    parent: { database_id: newsDb },
    properties: {
      主题: {
        type: "title",
        title: rt(pageId === newsId ? "公开交流活动" : "团队分享"),
      },
      类型: validField
        ? {
            type: "multi_select",
            multi_select: names.map((name) => ({ name })),
          }
        : { type: "rich_text", rich_text: rt("中心动态") },
      活动类型: { type: "select", select: { name: "线上访谈" } },
      时间: { type: "date", date: { start: "2026/10/20" } },
      "分享者/受访者": {
        type: "multi_select",
        multi_select: [{ name: "受访者不是文章作者" }],
      },
    },
  });
  const client = {
    call: async (route) => {
      assert.ok(route.endsWith("/content/markdown") && route.includes(newsId));
      bodyReads++;
      return { markdown: "已确认公开的活动正文。" };
    },
    list: async (route) =>
      route.endsWith("/query")
        ? [make(newsId, tags), make(excludedId, ["团队分享", "中心动态草稿"])]
        : [],
  };
  const service = await createFlowusService({ clientFactory: () => client });
  const run = async () => {
    await service.run();
    for (let n = 0; n < 200; n++) {
      const current = await service.status();
      if (!current.running) return current.lastRun;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("sync timeout");
  };
  const saved = async () =>
    (await readData("content.json")).entries.find(
      (e) => e.flowus?.pageId === newsId,
    );
  try {
    await service.configure({
      sources: [
        {
          id: newsDb,
          type: "database",
          kind: "news",
          publishField: "类型",
          publishValue: "中心动态",
        },
      ],
      token: "fixture-only",
      autoPublish: true,
      intervalMinutes: 0,
    });
    assert.equal((await run()).published, 1);
    assert.equal(bodyReads, 1);
    assert.equal((await saved()).kind, "news");
    assert.equal((await saved()).category, "线上访谈");
    assert.equal((await saved()).date, "2026-10-20");
    assert.equal((await saved()).author, "");
    assert.ok(
      !(await readData("content.json")).entries.some(
        (e) => e.flowus?.pageId === excludedId,
      ),
    );
    assert.equal((await run()).unchanged, 1);
    validField = false;
    assert.ok((await run()).errors.length);
    assert.equal((await saved()).status, "published");
    validField = true;
    tags = ["线上访谈"];
    assert.equal((await run()).withdrawn, 1);
    assert.equal((await saved()).status, "draft");
  } finally {
    service.close();
  }
});

test("directory discovery verifies inline databases from Markdown and never follows arbitrary links", async () => {
  const calls = [];
  const client = {
    call: async (route) => {
      calls.push(route);
      if (route === "/pages/" + id)
        return {
          properties: { title: { type: "title", title: rt("公开目录") } },
        };
      if (route.endsWith("/content/markdown"))
        return {
          markdown: `[未命名数据库](https://flowus.cn/${db})\n\n[未命名数据库](https://evil.test/${draftId})`,
        };
      if (route === "/databases/" + db) return { title: rt("观点") };
      throw new Error("unexpected route");
    },
    list: async () => [],
  };
  const service = await createFlowusService({ clientFactory: () => client });
  try {
    await service.configure({
      discoveryRoot: id,
      sources: [],
      token: "fixture-only",
      autoPublish: true,
      intervalMinutes: 0,
    });
    const result = await service.discover();
    assert.deepEqual(result.sources, [
      { id: db, type: "database", title: "观点", linked: true },
    ]);
    assert.deepEqual(result.warnings, []);
    assert.ok(!calls.some((route) => route.includes(draftId)));
    assert.equal((await service.status()).config.sources.length, 0);
  } finally {
    service.close();
  }
});
