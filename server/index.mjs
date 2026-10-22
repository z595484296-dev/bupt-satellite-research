import http from "node:http";
import { readFile, writeFile, mkdir, stat, rename } from "node:fs/promises";
import { isIP } from "node:net";
import { createReadStream } from "node:fs";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import Busboy from "busboy";
import { createFlowusService, publicContent } from "./flowus-service.mjs";
import { syncMediaPattern, isImage } from "./flowus-content.mjs";
import { createSitesMirror } from "./sites-mirror.mjs";
import {
  initStorage,
  readData,
  mutateData,
  dataDir,
  mediaDir,
  error,
  validateEntry,
  validateInquiry,
} from "./storage.mjs";
const production = process.argv.includes("--production");
const runtimeDir = path.resolve(process.env.RUNTIME_DIR || ".runtime");
const sessions = new Map(),
  limits = new Map();
await initStorage();
const flowus = await createFlowusService();
const sitesMirror = createSitesMirror({
  flowusBusy: async () => (await flowus.status()).running,
});
await mkdir(runtimeDir, { recursive: true });
let auth;
try {
  auth = JSON.parse(await readFile(path.join(dataDir, "admin.json"), "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  const password =
    process.env.ADMIN_PASSWORD || randomBytes(18).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  auth = {
    username: "admin",
    salt,
    hash: scryptSync(password, salt, 64).toString("hex"),
  };
  await writeFile(path.join(dataDir, "admin.json"), JSON.stringify(auth), {
    mode: 0o600,
  });
  if (!process.env.ADMIN_PASSWORD)
    await writeFile(
      path.join(runtimeDir, "admin-credentials.txt"),
      `本地内容管理后台\n用户名：admin\n初始密码：${password}\n请登录后更改密码。此文件不要上传或公开。\n`,
      { mode: 0o600 },
    );
}
const send = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const readBody = async (req) => {
  let size = 0,
    chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 180000) throw error(413, "内容过大。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw error(400, "无法读取请求内容。");
  }
};
function rate(req, key, max, windowMs = 60000) {
  const peer = req.socket.remoteAddress;
  const forwarded = req.headers["x-real-ip"];
  const trusted =
    process.env.TRUST_LOOPBACK_PROXY === "true" &&
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer);
  const id =
    key +
    (trusted && typeof forwarded === "string" && isIP(forwarded)
      ? forwarded
      : peer);
  const now = Date.now();
  const item = limits.get(id) || { count: 0, until: now + windowMs };
  if (item.until < now) {
    item.count = 0;
    item.until = now + windowMs;
  }
  item.count++;
  limits.set(id, item);
  if (item.count > max) throw error(429, "操作过于频繁，请稍后再试。");
}
function session(req) {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("center_session="))
    ?.slice(15);
  const s = sessions.get(token);
  if (!s || s.until < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return token;
}
function requireAuth(req) {
  if (!session(req)) throw error(401, "请先登录内容管理后台。");
}
function originCheck(req) {
  if (["GET", "HEAD"].includes(req.method)) return;
  const origin = req.headers.origin;
  let host;
  try {
    host = new URL(origin).host;
  } catch {}
  if (!host || host !== req.headers.host) throw error(403, "请求来源无效。");
}
const cookie = (token, expire = false) =>
  `center_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expire ? 0 : 28800}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`;
async function upload(req) {
  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = (e) => {
      if (failed) return;
      failed = true;
      reject(e.status ? e : error(400, "上传未完成，请重新选择文件。"));
    };
    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 0, parts: 2 },
      });
    } catch {
      return reject(error(400, "请选择文件。"));
    }
    let bytes = [],
      tooBig = false,
      count = 0;
    bb.on("file", (_name, file) => {
      count++;
      file.on("limit", () => (tooBig = true));
      file.on("data", (d) => bytes.push(d));
      file.on("error", fail);
    });
    bb.on("fieldsLimit", () => (tooBig = true));
    bb.on("filesLimit", () => (tooBig = true));
    bb.on("partsLimit", () => (tooBig = true));
    bb.on("error", fail);
    req.on("aborted", () => {
      fail(error(400, "上传连接已断开。"));
      bb.destroy();
    });
    req.on("error", fail);
    bb.on("close", async () => {
      if (failed) return;
      try {
        if (tooBig) throw error(413, "每次上传一个文件，最大 10 MB。");
        if (count !== 1) throw error(400, "请选择一个文件。");
        const buf = Buffer.concat(bytes);
        let ext;
        if (
          buf
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          ext = "png";
        else if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255)
          ext = "jpg";
        else if (
          buf.toString("ascii", 0, 4) === "RIFF" &&
          buf.toString("ascii", 8, 12) === "WEBP"
        )
          ext = "webp";
        else if (buf.toString("ascii", 0, 5) === "%PDF-") ext = "pdf";
        else throw error(400, "仅支持 PNG、JPEG、WebP 图片和 PDF。");
        const filename = randomUUID() + "." + ext;
        await writeFile(path.join(mediaDir, filename), buf, {
          flag: "wx",
          mode: 0o600,
        });
        resolve({ url: "/media/" + filename, type: ext, size: buf.length });
      } catch (e) {
        reject(e);
      }
    });
    req.pipe(bb);
  });
}
async function api(req, res, url) {
  originCheck(req);
  const p = url.pathname;
  if (p === "/api/content" && req.method === "GET") {
    const data = await readData("content.json");
    return send(res, 200, publicContent(data));
  }
  if (p === "/api/inquiries" && req.method === "POST") {
    rate(req, "inquiry", 5, 600000);
    const b = await readBody(req);
    if (b.website) throw error(400, "无法提交。");
    const item = {
      ...validateInquiry(b),
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      status: "new",
    };
    await mutateData("inquiries.json", (items) => [item, ...items]);
    return send(res, 201, { id: item.id });
  }
  if (p === "/api/admin/login" && req.method === "POST") {
    rate(req, "login", 8, 600000);
    const b = await readBody(req);
    const pass = String(b.password ?? "");
    if (pass.length > 200) throw error(400, "密码过长。");
    const valid = timingSafeEqual(
      scryptSync(pass, auth.salt, 64),
      Buffer.from(auth.hash, "hex"),
    );
    if (b.username !== auth.username || !valid)
      throw error(401, "用户名或密码不正确。");
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { until: Date.now() + 28800000 });
    res.setHeader("Set-Cookie", cookie(token));
    return send(res, 200, { ok: true });
  }
  if (p === "/api/admin/session" && req.method === "GET")
    return send(res, 200, { authenticated: !!session(req) });
  if (p.startsWith("/api/admin/")) {
    requireAuth(req);
    if (p === "/api/admin/flowus" && req.method === "GET")
      return send(res, 200, {
        ...(await flowus.status()),
        mirror: await sitesMirror.status(),
      });
    if (p === "/api/admin/sites/sync" && req.method === "POST")
      return send(res, 200, await sitesMirror.run());
    if (p === "/api/admin/flowus/config" && req.method === "POST")
      return send(res, 200, await flowus.configure(await readBody(req)));
    if (p === "/api/admin/flowus/connection" && req.method === "POST")
      return send(res, 200, await flowus.connection());
    if (p === "/api/admin/flowus/discover" && req.method === "POST")
      return send(res, 200, await flowus.discover());
    if (p === "/api/admin/flowus/sync" && req.method === "POST")
      return send(res, 202, await flowus.run());
    if (p === "/api/admin/flowus/publish" && req.method === "POST")
      return send(
        res,
        200,
        await flowus.approve((await readBody(req)).revision),
      );
    if (
      p.startsWith("/api/admin/flowus/media/") &&
      ["GET", "HEAD"].includes(req.method)
    ) {
      const parts = p.slice("/api/admin/flowus/media/".length).split("/");
      if (parts.length !== 2) throw error(404, "文件不存在。");
      const file = await flowus.previewFile(...parts);
      res.setHeader("Cache-Control", "no-store");
      if (!isImage(path.extname(file).slice(1)))
        res.setHeader("Content-Disposition", "attachment");
      return serveFile(req, res, file);
    }
    if (p === "/api/admin/logout" && req.method === "POST") {
      sessions.delete(session(req));
      res.setHeader("Set-Cookie", cookie("", true));
      return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/password" && req.method === "POST") {
      const b = await readBody(req);
      const current = String(b.current ?? "");
      if (
        current.length > 200 ||
        !timingSafeEqual(
          scryptSync(current, auth.salt, 64),
          Buffer.from(auth.hash, "hex"),
        )
      )
        throw error(400, "当前密码不正确。");
      if (
        typeof b.password !== "string" ||
        b.password.length < 12 ||
        b.password.length > 200
      )
        throw error(400, "新密码需为 12–200 个字符。");
      const salt = randomBytes(16).toString("hex");
      const nextAuth = {
        ...auth,
        salt,
        hash: scryptSync(b.password, salt, 64).toString("hex"),
      };
      const authFile = path.join(dataDir, "admin.json");
      const authTemp = authFile + "." + randomUUID() + ".tmp";
      await writeFile(authTemp, JSON.stringify(nextAuth), {
        mode: 0o600,
      });
      await rename(authTemp, authFile);
      auth = nextAuth;
      sessions.clear();
      res.setHeader("Set-Cookie", cookie("", true));
      return send(res, 200, { ok: true });
    }
    if (p === "/api/admin/content" && req.method === "GET")
      return send(res, 200, await readData("content.json"));
    if (p === "/api/admin/entries" && req.method === "POST") {
      const b = await readBody(req),
        entry = validateEntry(b.entry);
      const result = await mutateData("content.json", (old) => {
        if (b.version !== old.version)
          throw error(409, "内容已被更新，请刷新后再保存。");
        const id = b.entry.id || randomUUID();
        const found = old.entries.find((e) => e.id === id);
        if (b.entry.id && !found) throw error(404, "内容不存在。");
        const next = {
          ...entry,
          ...(found?.flowus
            ? { flowus: found.flowus, attachments: found.attachments || [] }
            : {}),
          id,
          updatedAt: new Date().toISOString(),
        };
        return {
          ...old,
          version: old.version + 1,
          entries: found
            ? old.entries.map((e) => (e.id === id ? next : e))
            : [next, ...old.entries],
        };
      });
      return send(res, 200, result);
    }
    if (p === "/api/admin/settings" && req.method === "POST") {
      const b = await readBody(req);
      const result = await mutateData("content.json", (old) => {
        if (b.version !== old.version)
          throw error(409, "内容已更新，请刷新后再保存。");
        const next = { ...old.settings };
        for (const key of [
          "heroTitle",
          "heroSubtitle",
          "aboutTitle",
          "aboutIntro",
          "aboutBody",
          "contactEmail",
          "footer",
        ]) {
          if (
            typeof b.settings?.[key] !== "string" ||
            b.settings[key].length > 5000
          )
            throw error(400, "站点信息无效。");
          next[key] = b.settings[key].trim();
        }
        if (!next.heroTitle || !next.aboutIntro)
          throw error(400, "标题和简介不能为空。");
        if (
          next.contactEmail &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.contactEmail)
        )
          throw error(400, "联系邮箱格式不正确。");
        if (
          !Array.isArray(b.settings.directions) ||
          b.settings.directions.length !== 4
        )
          throw error(400, "请保留四个研究方向。");
        next.directions = b.settings.directions.map((d) => {
          if (
            !d.title?.trim() ||
            d.title.length > 50 ||
            typeof d.description !== "string" ||
            d.description.length > 150
          )
            throw error(400, "研究方向内容无效。");
          return { title: d.title.trim(), description: d.description.trim() };
        });
        return { ...old, version: old.version + 1, settings: next };
      });
      return send(res, 200, result);
    }
    if (p === "/api/admin/upload" && req.method === "POST") {
      rate(req, "upload", 30);
      return send(res, 201, await upload(req));
    }
    if (p === "/api/admin/inquiries" && req.method === "GET")
      return send(res, 200, await readData("inquiries.json"));
    if (p === "/api/admin/inquiries" && req.method === "POST") {
      const b = await readBody(req);
      if (!["new", "read", "done"].includes(b.status))
        throw error(400, "状态无效。");
      const result = await mutateData("inquiries.json", (items) =>
        items.map((i) => (i.id === b.id ? { ...i, status: b.status } : i)),
      );
      return send(res, 200, result);
    }
    if (p === "/api/admin/export" && req.method === "GET") {
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="center-content.json"',
      );
      return send(res, 200, await readData("content.json"));
    }
  }
  throw error(404, "接口不存在。");
}
const types = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",
};
async function serveFile(req, res, file) {
  const info = await stat(file);
  if (!info.isFile()) throw error(404, "文件不存在。");
  res.writeHead(200, {
    "Content-Type": types[path.extname(file)] || "application/octet-stream",
    "Content-Length": info.size,
  });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      server: {
        middlewareMode: true,
        fs: {
          deny: [
            ".env",
            ".env.*",
            "**/*.{crt,pem}",
            "**/.git/**",
            dataDir + "/**",
            runtimeDir + "/**",
            "**/server/**",
            "**/data/**",
            "**/.runtime/**",
          ],
        },
      },
      appType: "spa",
    });
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname.startsWith("/media/")) {
      if (!["GET", "HEAD"].includes(req.method))
        throw error(405, "不支持的请求。");
      const file = url.pathname.slice(7);
      const synced = syncMediaPattern.test(url.pathname);
      if (!synced && !/^[a-f0-9-]+\.(png|jpg|webp|pdf)$/.test(file))
        throw error(404, "文件不存在。");
      if (synced) {
        const content = await readData("content.json");
        if (
          !content.entries.some(
            (e) =>
              e.status === "published" &&
              (e.body?.includes(url.pathname) ||
                e.attachments?.some((a) => a.url === url.pathname)),
          )
        )
          throw error(404, "文件不存在。");
      }
      res.setHeader(
        "Cache-Control",
        synced ? "no-store" : "public, max-age=86400",
      );
      if (!isImage(path.extname(file).slice(1)))
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="research' + path.extname(file) + '"',
        );
      return await serveFile(req, res, path.join(mediaDir, file));
    }
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(
        "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n",
      );
    }
    const decoded = decodeURIComponent(url.pathname).replaceAll("\\", "/");
    if (
      /(?:^|\/)(?:data|\.runtime|server|\.git|\.env)(?:\/|\.|$)/i.test(
        decoded,
      ) ||
      decoded.startsWith("/@fs/")
    )
      throw error(404, "文件不存在。");
    if (!production) return vite.middlewares(req, res);
    if (!["GET", "HEAD"].includes(req.method))
      throw error(405, "不支持的请求。");
    const base = path.resolve("dist/client");
    const file = path.resolve(base, "." + decodeURIComponent(url.pathname));
    if (file !== base && !file.startsWith(base + path.sep))
      throw error(403, "路径无效。");
    if (path.extname(file)) {
      return await serveFile(req, res, file);
    }
    const html = await readFile(path.join(base, "index.html"), "utf8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(html);
  } catch (e) {
    if (!res.headersSent)
      send(res, e.status || (e.code === "ENOENT" ? 404 : 500), {
        error: e.status
          ? e.message
          : e.code === "ENOENT"
            ? "文件不存在。"
            : "暂时无法处理请求，请稍后重试。",
      });
    else res.end();
    if (!e.status && e.code !== "ENOENT") console.error(e);
  }
});
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const port = Number(process.env.PORT || arg("--port") || 0);
server.listen(
  port,
  process.env.HOST || arg("--host") || "127.0.0.1",
  async () => {
    const actual = server.address().port;
    const url = `http://127.0.0.1:${actual}`;
    await writeFile(
      path.join(runtimeDir, "connection.json"),
      JSON.stringify(
        {
          url,
          port: actual,
          pid: process.pid,
          mode: production ? "production" : "development",
        },
        null,
        2,
      ),
    );
    console.log(`Website ready: ${url}\nAdmin: ${url}/admin`);
  },
);
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  for (const [k, v] of sessions) if (v.until < now) sessions.delete(k);
}, 60000).unref();
