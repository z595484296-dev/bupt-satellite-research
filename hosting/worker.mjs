const mediaPath =
  /^\/media\/[a-f0-9-]+\.(?:png|jpg|webp|gif|avif|pdf|docx|xlsx|pptx)$/;
const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const failure = (status, message) =>
  Object.assign(new Error(message), { status });
const types = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
async function body(request, limit = 2000000) {
  if (Number(request.headers.get("content-length")) > limit)
    throw failure(413, "内容过大。");
  const reader = request.body?.getReader();
  if (!reader) throw failure(400, "请求内容为空。");
  let length = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw failure(413, "内容过大。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function parse(request, limit) {
  try {
    return JSON.parse(new TextDecoder().decode(await body(request, limit)));
  } catch (e) {
    throw e.status ? e : failure(400, "内容格式无效。");
  }
}
function authorize(request, env) {
  if (
    !env.SYNC_TOKEN ||
    request.headers.get("X-Center-Sync") !== env.SYNC_TOKEN
  )
    throw failure(401, "需要同步授权。");
}
async function snapshot(env) {
  const object = await env.BUCKET.get("published/current.json");
  return object ? object.json() : null;
}
function validateFiles(files) {
  if (
    !Array.isArray(files) ||
    files.length > 2000 ||
    new Set(files.map((f) => f.url)).size !== files.length
  )
    throw failure(400, "文件清单无效。");
  for (const f of files)
    if (
      !mediaPath.test(f.url) ||
      !/^[a-f0-9]{64}$/.test(f.hash) ||
      !Number.isInteger(f.size) ||
      f.size < 1 ||
      f.size > 32 * 1024 * 1024
    )
      throw failure(400, "文件记录无效。");
}
async function sync(request, env, url) {
  authorize(request, env);
  if (request.method === "POST" && url.pathname === "/api/sync/prepare") {
    const value = await parse(request);
    validateFiles(value.files);
    const missing = [];
    for (const file of value.files) {
      const object = await env.BUCKET.head(file.url.slice(1));
      if (
        object?.customMetadata?.sha256 !== file.hash ||
        object.size !== file.size
      )
        missing.push(file.url);
    }
    const current = await snapshot(env);
    return json({ missing, digest: current?.digest || "" });
  }
  if (request.method === "PUT" && url.pathname.startsWith("/api/sync/media/")) {
    const media = url.pathname.replace("/api/sync", "");
    if (!mediaPath.test(media)) throw failure(400, "文件路径无效。");
    const bytes = await body(request, 32 * 1024 * 1024);
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== request.headers.get("X-Content-SHA256"))
      throw failure(400, "文件校验失败。");
    await env.BUCKET.put(media.slice(1), bytes, {
      customMetadata: { sha256: hash },
      httpMetadata: { contentType: types[media.split(".").at(-1)] },
    });
    return json({ ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/sync/commit") {
    const next = await parse(request);
    validateFiles(next.files);
    if (
      !next.content?.settings ||
      !Array.isArray(next.content.entries) ||
      next.content.entries.length > 1000 ||
      next.content.entries.some((e) => e.status !== "published" || e.flowus) ||
      !/^[a-f0-9]{64}$/.test(next.digest)
    )
      throw failure(400, "公开内容无效。");
    for (const file of next.files) {
      const object = await env.BUCKET.head(file.url.slice(1));
      if (
        object?.customMetadata?.sha256 !== file.hash ||
        object.size !== file.size
      )
        throw failure(409, "文件尚未完成同步。");
    }
    // Commit a single pointer only after every file has arrived. Old media is
    // immediately revoked by the new allowlist, without exposing draft assets.
    await env.BUCKET.put(
      "published/current.json",
      JSON.stringify({ ...next, syncedAt: new Date().toISOString() }),
    );
    return json({
      ok: true,
      digest: next.digest,
      count: next.content.entries.length,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/sync/inquiries") {
    const listed = await env.BUCKET.list({
      prefix: "inquiries/pending/",
      limit: 100,
    });
    return json({
      items: await Promise.all(
        listed.objects.map(async (o) => (await env.BUCKET.get(o.key)).json()),
      ),
    });
  }
  if (request.method === "POST" && url.pathname === "/api/sync/ack") {
    const { ids } = await parse(request, 20000);
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some((id) => !/^[a-f0-9-]{36}$/.test(id))
    )
      throw failure(400, "记录编号无效。");
    for (const id of ids) {
      const key = `inquiries/pending/${id}.json`;
      const record = await env.BUCKET.get(key);
      if (record) {
        await env.BUCKET.put(`inquiries/received/${id}.json`, record.body);
        await env.BUCKET.delete(key);
      }
    }
    return json({ ok: true });
  }
  throw failure(404, "接口不存在。");
}
async function inquiry(request, env) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw failure(403, "请从本网站提交。");
  const raw = await parse(request, 12000);
  if (raw.website) throw failure(400, "请重新填写表单。");
  const out = {};
  for (const [key, max] of Object.entries({
    name: 60,
    organization: 160,
    email: 254,
    direction: 30,
    message: 2000,
  })) {
    out[key] = String(raw[key] || "").trim();
    if (out[key].length > max) throw failure(400, "填写内容超出长度限制。");
  }
  if (
    !out.name ||
    !out.message ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email) ||
    !["联合研究", "产业交流", "学术研讨", "其他合作"].includes(out.direction)
  )
    throw failure(400, "请完整填写姓名、邮箱、合作方向与需求。");
  const id = crypto.randomUUID();
  await env.BUCKET.put(
    `inquiries/pending/${id}.json`,
    JSON.stringify({
      ...out,
      id,
      createdAt: new Date().toISOString(),
      status: "new",
      source: "sites",
    }),
  );
  return json({ id }, 201);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/sync/"))
        return await sync(request, env, url);
      if (url.pathname === "/api/inquiries" && request.method === "POST")
        return await inquiry(request, env);
      if (
        url.pathname === "/api/content" &&
        ["GET", "HEAD"].includes(request.method)
      ) {
        const current = await snapshot(env);
        return current
          ? json(current.content)
          : json({ error: "内容正在首次同步，请稍后刷新。" }, 503);
      }
      if (url.pathname.startsWith("/api/"))
        return json({ error: "内容管理请使用本地管理后台。" }, 404);
      if (url.pathname.startsWith("/media/")) {
        if (
          !["GET", "HEAD"].includes(request.method) ||
          !mediaPath.test(url.pathname)
        )
          return new Response(null, { status: 404 });
        const current = await snapshot(env);
        if (!current?.files.some((f) => f.url === url.pathname))
          return new Response(null, { status: 404 });
        const object = await env.BUCKET.get(url.pathname.slice(1));
        if (!object) return new Response(null, { status: 404 });
        const headers = new Headers({
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        object.writeHttpMetadata(headers);
        return new Response(request.method === "HEAD" ? null : object.body, {
          headers,
        });
      }
      const response = await env.ASSETS.fetch(request);
      if (
        response.status !== 404 ||
        !request.headers.get("accept")?.includes("text/html") ||
        !["GET", "HEAD"].includes(request.method)
      )
        return response;
      url.pathname = "/index.html";
      url.search = "";
      return env.ASSETS.fetch(new Request(url, request));
    } catch (e) {
      return json(
        { error: e.status ? e.message : "服务暂时不可用，请稍后重试。" },
        e.status || 500,
      );
    }
  },
};
