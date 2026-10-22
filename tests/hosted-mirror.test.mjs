import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../hosting/worker.mjs";

test("hosted mirror commits complete snapshots, revokes removed media and protects inquiries", async () => {
  const objects = new Map();
  const BUCKET = {
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, ...options });
    },
    async get(key) {
      const object = objects.get(key);
      return (
        object && {
          ...object,
          size: object.bytes.length,
          body: object.bytes,
          json: async () => JSON.parse(new TextDecoder().decode(object.bytes)),
          writeHttpMetadata: (h) =>
            h.set(
              "Content-Type",
              object.httpMetadata?.contentType || "application/json",
            ),
        }
      );
    },
    async head(key) {
      return this.get(key);
    },
    async delete(key) {
      objects.delete(key);
    },
    async list({ prefix }) {
      return {
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key })),
      };
    },
  };
  const env = {
    BUCKET,
    SYNC_TOKEN: "fixture-sync",
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
  };
  const origin = "https://fixture.chatgpt.site";
  const call = (route, method = "GET", value, headers = {}) =>
    worker.fetch(
      new Request(origin + route, {
        method,
        headers,
        body:
          value === undefined
            ? undefined
            : typeof value === "string" || value instanceof Uint8Array
              ? value
              : JSON.stringify(value),
      }),
      env,
    );
  const auth = { "X-Center-Sync": env.SYNC_TOKEN };
  const bytes = new Uint8Array([1, 2, 3]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const file = {
    url: "/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
    size: 3,
    hash,
  };
  const content = {
    version: 1,
    settings: { name: "公开中心" },
    entries: [
      {
        id: "a",
        status: "published",
        kind: "news",
        title: "公开文章",
        body: "正文",
      },
    ],
  };
  const payload = { content, files: [file], digest: hash };
  assert.equal((await call("/api/sync/commit", "POST", payload)).status, 401);
  assert.equal(
    (await call("/api/sync/commit", "POST", payload, auth)).status,
    409,
  );
  assert.equal(
    (
      await call("/api/sync" + file.url, "PUT", bytes, {
        ...auth,
        "X-Content-SHA256": hash,
      })
    ).status,
    200,
  );
  assert.equal((await call(file.url)).status, 404);
  assert.equal(
    (await call("/api/sync/commit", "POST", payload, auth)).status,
    200,
  );
  assert.deepEqual(await (await call("/api/content")).json(), content);
  assert.equal((await call(file.url)).status, 200);
  assert.equal(
    (
      await call(
        "/api/sync/commit",
        "POST",
        {
          ...payload,
          content: {
            ...content,
            entries: [{ ...content.entries[0], status: "draft" }],
          },
        },
        auth,
      )
    ).status,
    400,
  );
  await call("/api/sync/commit", "POST", { ...payload, files: [] }, auth);
  assert.equal((await call(file.url)).status, 404);
  const inquiry = {
    name: "自动验收",
    email: "test@example.invalid",
    direction: "联合研究",
    message: "验证存储流程",
  };
  assert.equal((await call("/api/inquiries", "POST", inquiry)).status, 403);
  const submitted = await call("/api/inquiries", "POST", inquiry, {
    Origin: origin,
  });
  assert.equal(submitted.status, 201);
  const { id } = await submitted.json();
  assert.equal((await call("/api/sync/inquiries")).status, 401);
  assert.equal(
    (await (await call("/api/sync/inquiries", "GET", undefined, auth)).json())
      .items[0].id,
    id,
  );
  assert.equal(
    (await call("/api/sync/ack", "POST", { ids: [id] }, auth)).status,
    200,
  );
  assert.equal(
    (await (await call("/api/sync/inquiries", "GET", undefined, auth)).json())
      .items.length,
    0,
  );
  assert.ok(objects.has(`inquiries/received/${id}.json`));
});
