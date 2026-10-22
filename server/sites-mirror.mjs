import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { dataDir, mediaDir, readData, mutateData } from "./storage.mjs";
import { publicContent } from "./flowus-service.mjs";
import { atomicWriteJson } from "./atomic-file.mjs";
import { fetch, EnvHttpProxyAgent } from "undici";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mediaPattern =
  /\/media\/[a-f0-9-]+\.(?:png|jpg|webp|gif|avif|pdf|docx|xlsx|pptx)/g;

export function createSitesMirror({ flowusBusy = async () => false } = {}) {
  const url = process.env.SITES_MIRROR_URL || "";
  const token = process.env.SITES_SYNC_TOKEN;
  const bypass = process.env.SITES_ACCESS_TOKEN;
  const enabled =
    /^https:\/\/[a-z0-9.-]+\.chatgpt\.site$/.test(url) && !!token && !!bypass;
  const dispatcher = enabled ? new EnvHttpProxyAgent() : null;
  let running = false;
  const statePath = path.join(dataDir, "sites-mirror-state.json");
  let state = { lastSuccess: null, error: "", entries: 0, digest: "" };
  async function status() {
    return { ...state, enabled, running, url: enabled ? url : "" };
  }
  async function call(route, body, options = {}) {
    const response = await fetch(url + route, {
      dispatcher,
      method: body === undefined ? "GET" : "POST",
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Center-Sync": token,
        "OAI-Sites-Authorization": `Bearer ${bypass}`,
        ...options.headers,
      },
      body:
        body === undefined
          ? undefined
          : typeof body === "string" || body instanceof Uint8Array
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Sites 同步请求失败（${response.status}），将自动重试。`);
    return response.json();
  }
  async function run() {
    if (!enabled || running) return status();
    running = true;
    try {
      if (await flowusBusy()) return { ...(await status()), running: false };
      const content = publicContent(await readData("content.json"));
      const files = [];
      for (const url of new Set(
        JSON.stringify(content).match(mediaPattern) || [],
      )) {
        const bytes = await readFile(path.join(mediaDir, path.basename(url)));
        files.push({ url, size: bytes.length, hash: sha(bytes) });
      }
      const digest = sha(JSON.stringify({ content, files }));
      const remote = await call("/api/sync/prepare", { files });
      if (digest !== remote.digest || remote.missing.length) {
        for (const url of remote.missing) {
          const file = files.find((f) => f.url === url);
          if (!file) throw new Error("Sites 返回了未知文件，已停止同步。");
          await call(
            "/api/sync" + url,
            await readFile(path.join(mediaDir, path.basename(url))),
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/octet-stream",
                "X-Content-SHA256": file.hash,
              },
            },
          );
        }
        // If a local editor changed content during upload, use the next pass.
        if ((await readData("content.json")).version !== content.version)
          throw new Error("内容正在更新，将在下一轮完成 Sites 同步。");
        await call("/api/sync/commit", { content, files, digest });
      }
      const inbox = await call("/api/sync/inquiries");
      if (inbox.items?.length) {
        await mutateData("inquiries.json", (old) => {
          const fresh = inbox.items.filter(
            (item) => !old.some((x) => x.id === item.id),
          );
          return fresh.length ? [...fresh, ...old] : old;
        });
        await call("/api/sync/ack", {
          ids: inbox.items.map((item) => item.id),
        });
      }
      state = {
        lastSuccess: new Date().toISOString(),
        entries: content.entries.length,
        media: files.length,
        digest,
        error: "",
      };
    } catch (e) {
      state = {
        ...state,
        error: /^Sites |^内容正在|^Sites 返回/.test(e.message)
          ? e.message
          : "Sites 同步暂未完成，网站保留上一版，将自动重试。",
      };
    } finally {
      try {
        await atomicWriteJson(statePath, state);
      } finally {
        running = false;
      }
    }
    return status();
  }
  if (enabled)
    readFile(statePath, "utf8")
      .then((text) => {
        if (!running) state = JSON.parse(text);
      })
      .catch(() => {});
  const timer = enabled
    ? setInterval(() => run().catch(() => {}), 60000)
    : null;
  timer?.unref();
  return {
    status,
    run,
    close: () => {
      clearInterval(timer);
      dispatcher?.close().catch(() => {});
    },
  };
}
