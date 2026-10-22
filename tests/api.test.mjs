import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
test("persistent CMS, publication, files, inquiries and access boundaries", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "satellite-center-api-"));
  const password = randomBytes(18).toString("base64url");
  let proc,
    url,
    cookie = "";
  async function start(production = true, trustProxy = false) {
    proc = spawn(
      process.execPath,
      ["server/index.mjs", ...(production ? ["--production"] : [])],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: "0",
          HOST: "127.0.0.1",
          DATA_DIR: path.join(root, "data"),
          RUNTIME_DIR: path.join(root, "runtime"),
          ADMIN_PASSWORD: password,
          TRUST_LOOPBACK_PROXY: trustProxy ? "true" : "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Server did not start")),
        20000,
      );
      proc.stdout.on("data", (d) => {
        output += d;
        const m = output.match(/Website ready: (http:\/\/[^\s]+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error("Server exit " + code));
      });
    });
  }
  async function stop() {
    if (proc.exitCode !== null) return;
    const done = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await done;
  }
  t.after(stop);
  await start();
  async function call(
    route,
    { method = "GET", body, auth = false, origin = url } = {},
  ) {
    return fetch(url + route, {
      method,
      headers: {
        ...(method === "GET" ? {} : { Origin: origin }),
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(auth ? { Cookie: cookie } : {}),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
  }
  let data, entry, media;
  await t.test("public seed and private data boundary", async () => {
    let r = await call("/api/content");
    assert.equal(r.status, 200);
    data = await r.json();
    assert.ok(data.entries.length >= 7);
    assert.ok(data.entries.every((e) => e.status === "published"));
    for (const p of [
      "/api/admin/content",
      "/api/admin/inquiries",
      "/api/admin/export",
      "/api/admin/flowus",
      "/api/admin/flowus/media/unknown/file.png",
    ])
      assert.equal((await call(p)).status, 401);
    for (const p of [
      "/data/admin.json",
      "/.runtime/admin-credentials.txt",
      "/server/index.mjs",
      "/@fs/C:/secret",
    ])
      assert.equal((await call(p)).status, 404);
  });
  await t.test("CSRF rejection and valid authenticated session", async () => {
    assert.equal(
      (
        await call("/api/admin/login", {
          method: "POST",
          origin: "https://elsewhere.test",
          body: { username: "admin", password },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("/api/admin/login", {
          method: "POST",
          body: { username: "admin", password: "wrong" },
        })
      ).status,
      401,
    );
    const r = await call("/api/admin/login", {
      method: "POST",
      body: { username: "admin", password },
    });
    assert.equal(r.status, 200);
    const header = r.headers.get("set-cookie");
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/);
    cookie = header.split(";")[0];
    assert.equal(
      (await (await call("/api/admin/session", { auth: true })).json())
        .authenticated,
      true,
    );
  });
  await t.test(
    "FlowUs settings require authentication and CSRF and never expose tokens",
    async () => {
      let r = await call("/api/admin/flowus", { auth: true });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).config.hasToken, false);
      const body = {
        sources: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            type: "page",
            kind: "insight",
          },
        ],
        intervalMinutes: 0,
        autoPublish: true,
        token: "private-fixture-flowus-key",
      };
      assert.equal(
        (
          await call("/api/admin/flowus/config", {
            method: "POST",
            body,
            auth: true,
            origin: "https://elsewhere.test",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call("/api/admin/flowus/config", {
            method: "POST",
            body,
            auth: true,
          })
        ).status,
        200,
      );
      const safe = await (
        await call("/api/admin/flowus", { auth: true })
      ).text();
      assert.ok(!safe.includes(body.token));
      assert.equal(JSON.parse(safe).config.hasToken, true);
      assert.equal((await call("/data/flowus-private.json")).status, 404);
      assert.equal(
        (
          await call("/api/admin/flowus/config", {
            method: "POST",
            body: { ...body, token: "", clearToken: true },
            auth: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (await call("/api/admin/flowus/sync", { method: "POST", auth: true }))
          .status,
        400,
      );
    },
  );
  await t.test(
    "draft stays private and publication updates public API",
    async () => {
      entry = {
        kind: "research",
        status: "draft",
        title: "自动验证研究条目",
        body: "## 研究主题\n\n用于隔离环境的测试正文。",
        category: "测试分类",
        date: "2026-10-16",
      };
      let r = await call("/api/admin/entries", {
        method: "POST",
        auth: true,
        body: { version: data.version, entry },
      });
      assert.equal(r.status, 200);
      data = await r.json();
      entry = data.entries[0];
      assert.ok(
        !(await (await call("/api/content")).json()).entries.some(
          (e) => e.id === entry.id,
        ),
      );
      r = await call("/api/admin/entries", {
        method: "POST",
        auth: true,
        body: {
          version: data.version,
          entry: { ...entry, status: "published" },
        },
      });
      assert.equal(r.status, 200);
      data = await r.json();
      entry = data.entries[0];
      assert.ok(
        (await (await call("/api/content")).json()).entries.some(
          (e) => e.id === entry.id,
        ),
      );
      assert.equal(
        (
          await call("/api/admin/entries", {
            method: "POST",
            auth: true,
            body: { version: data.version - 1, entry },
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "upload image and PDF; reject executable masquerading as image",
    async () => {
      const form = new FormData();
      form.append(
        "file",
        new Blob([await readFile("public/assets/about-earth.png")], {
          type: "image/png",
        }),
        "earth.png",
      );
      let r = await call("/api/admin/upload", {
        method: "POST",
        auth: true,
        body: form,
      });
      assert.equal(r.status, 201, await r.clone().text());
      media = (await r.json()).url;
      r = await call(media);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "image/png");
      const pdf = new FormData();
      pdf.append(
        "file",
        new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }),
        "test.pdf",
      );
      r = await call("/api/admin/upload", {
        method: "POST",
        auth: true,
        body: pdf,
      });
      assert.equal(r.status, 201);
      const attachment = (await r.json()).url;
      assert.match(
        (await call(attachment)).headers.get("content-disposition"),
        /attachment/,
      );
      r = await call("/api/admin/entries", {
        method: "POST",
        auth: true,
        body: {
          version: data.version,
          entry: { ...entry, cover: media, attachment },
        },
      });
      assert.equal(r.status, 200);
      data = await r.json();
      entry = data.entries[0];
      const fake = new FormData();
      fake.append(
        "file",
        new Blob(["<script>alert(1)</script>"], { type: "image/png" }),
        "fake.png",
      );
      assert.equal(
        (
          await call("/api/admin/upload", {
            method: "POST",
            auth: true,
            body: fake,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "truncated multipart rejects without stopping server",
    async () => {
      const r = await fetch(url + "/api/admin/upload", {
        method: "POST",
        headers: {
          Origin: url,
          Cookie: cookie,
          "Content-Type": "multipart/form-data; boundary=broken",
        },
        body: '--broken\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\npartial-file',
      });
      assert.equal(r.status, 400);
      assert.equal((await call("/api/content")).status, 200);
    },
  );
  await t.test("settings, export and automatic backups", async () => {
    const r = await call("/api/admin/settings", {
      method: "POST",
      auth: true,
      body: {
        version: data.version,
        settings: { ...data.settings, footer: "隔离测试页脚" },
      },
    });
    assert.equal(r.status, 200);
    data = await r.json();
    assert.equal(
      (await (await call("/api/content")).json()).settings.footer,
      "隔离测试页脚",
    );
    assert.equal((await call("/api/admin/export", { auth: true })).status, 200);
    assert.ok((await readdir(path.join(root, "data", "backups"))).length >= 3);
  });
  await t.test(
    "validated cooperation inquiry persists and remains private",
    async () => {
      assert.equal(
        (
          await call("/api/inquiries", {
            method: "POST",
            body: { name: "测试", email: "bad" },
          })
        ).status,
        400,
      );
      let r = await call("/api/inquiries", {
        method: "POST",
        body: {
          name: "自动验证",
          organization: "隔离测试环境",
          email: "test@example.invalid",
          direction: "联合研究",
          message: "仅用于验证表单存储，不发送邮件。",
        },
      });
      assert.equal(r.status, 201);
      const { id } = await r.json();
      r = await call("/api/admin/inquiries", { auth: true });
      assert.equal((await r.json())[0].id, id);
      r = await call("/api/admin/inquiries", {
        method: "POST",
        auth: true,
        body: { id, status: "done" },
      });
      assert.equal((await r.json())[0].status, "done");
      assert.equal((await call("/api/admin/inquiries")).status, 401);
    },
  );
  await t.test(
    "restart retains content and inquiries; session expires",
    async () => {
      await stop();
      await start();
      assert.equal(
        (await (await call("/api/content")).json()).settings.footer,
        "隔离测试页脚",
      );
      assert.equal(
        (await call("/api/admin/content", { auth: true })).status,
        401,
      );
      assert.equal(
        JSON.parse(await readFile(path.join(root, "data", "inquiries.json")))[0]
          .status,
        "done",
      );
      assert.equal((await call(media)).status, 200);
    },
  );
  await t.test(
    "trusted proxy rate limits separate visitors and ignore untrusted spoofing",
    async () => {
      await stop();
      await start();
      const inquiry = (ip) =>
        fetch(url + "/api/inquiries", {
          method: "POST",
          headers: {
            Origin: url,
            "Content-Type": "application/json",
            "X-Real-IP": ip,
          },
          body: "{}",
        });
      for (let i = 0; i < 5; i++)
        assert.equal((await inquiry("198.51.100." + (i + 1))).status, 400);
      assert.equal((await inquiry("198.51.100.90")).status, 429);
      await stop();
      await start(true, true);
      for (let i = 0; i < 5; i++)
        assert.equal((await inquiry("198.51.100.1")).status, 400);
      assert.equal((await inquiry("198.51.100.1")).status, 429);
      assert.equal((await inquiry("198.51.100.2")).status, 400);
    },
  );
  await t.test(
    "password change persists atomically and invalidates existing session",
    async () => {
      let r = await call("/api/admin/login", {
        method: "POST",
        body: { username: "admin", password },
      });
      cookie = r.headers.get("set-cookie").split(";")[0];
      const updated = randomBytes(18).toString("base64url");
      assert.equal(
        (
          await call("/api/admin/password", {
            method: "POST",
            auth: true,
            body: { current: password, password: updated },
          })
        ).status,
        200,
      );
      assert.equal(
        (await call("/api/admin/content", { auth: true })).status,
        401,
      );
      assert.equal(
        (
          await call("/api/admin/login", {
            method: "POST",
            body: { username: "admin", password },
          })
        ).status,
        401,
      );
      await stop();
      await start();
      r = await call("/api/admin/login", {
        method: "POST",
        body: { username: "admin", password: updated },
      });
      assert.equal(r.status, 200);
      assert.equal(
        JSON.parse(await readFile(path.join(root, "data", "admin.json")))
          .username,
        "admin",
      );
    },
  );
  await t.test("development server also protects private files", async () => {
    await stop();
    await start(false);
    for (const p of [
      "/data/admin.json",
      "/.runtime/admin-credentials.txt",
      "/server/index.mjs",
      "/@fs/" + path.join(root, "data", "admin.json").replaceAll("\\", "/"),
    ])
      assert.equal((await call(p)).status, 404);
    assert.equal((await call("/")).status, 200);
  });
});
