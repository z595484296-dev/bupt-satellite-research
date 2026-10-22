import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { setTimeout as delay } from "node:timers/promises";
import { error } from "./storage.mjs";

export function publicAddress(address) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolveAsset(raw, resolve = lookup) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw error(422, "媒体地址无效。");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw error(422, "媒体只允许通过 HTTPS 标准端口下载。");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const records = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === "ipv4" ? 4 : 6 }]
    : await resolve(host, { all: true });
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw error(422, "媒体地址指向非公开网络，已停止下载。");
  return { url, address: records[0] };
}

// Resolve and pin the actual socket address on EVERY redirect; no credentials
// are ever sent to media hosts. This prevents DNS rebinding and SSRF.
export async function downloadAsset(raw, redirects = 0) {
  if (redirects > 4) throw error(422, "媒体重定向过多。");
  const { url, address } = await resolveAsset(raw);
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        agent: false,
        lookup: (_host, options, cb) =>
          options.all
            ? cb(null, [address])
            : cb(null, address.address, address.family),
        headers: {
          "Accept-Encoding": "identity",
          "User-Agent": "SatelliteCenter/1.0",
          ...(["cdn2.flowus.cn", "cdn.flowus.cn"].includes(url.hostname)
            ? { Referer: "https://flowus.cn/" }
            : {}),
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          let next;
          try {
            next = new URL(res.headers.location, url).href;
          } catch {
            return reject(error(422, "媒体重定向无效。"));
          }
          downloadAsset(next, redirects + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(error(422, "媒体下载失败，请检查来源文件的可用性。"));
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 20 * 1024 * 1024)
            req.destroy(error(422, "单个同步文件不能超过 20 MB。"));
          else chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(error(422, "媒体下载超时。")),
      30000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", () =>
      reject(error(422, "媒体下载失败或超时，请稍后重试。")),
    );
  });
}

export class FlowusClient {
  constructor(token, { fetcher = fetch, sleep = delay, interval = 550 } = {}) {
    this.token = token;
    this.fetcher = fetcher;
    this.sleep = sleep;
    this.interval = interval;
    this.last = 0;
  }
  async call(route, body) {
    // Keep the bearer credential on the official API origin, without redirects.
    if (
      !/^\/(users\/me|pages\/[a-f0-9-]+(?:\/content\/markdown)?|blocks\/[a-f0-9-]+\/children(?:\?.*)?|databases\/[a-f0-9-]+(?:\/query)?)$/.test(
        route,
      )
    )
      throw error(400, "不支持的 FlowUs 读取请求。");
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.sleep(Math.max(0, this.last + this.interval - Date.now()));
      this.last = Date.now();
      let response;
      try {
        response = await this.fetcher("https://api.flowus.cn/v2" + route, {
          method: body ? "POST" : "GET",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: "Bearer " + this.token,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (attempt < 2) continue;
        throw error(502, "暂时无法连接 FlowUs，已保留网站当前内容。");
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        const seconds = Number(response.headers.get("retry-after"));
        await this.sleep(
          Math.min(
            30000,
            Math.max(
              1000 * 2 ** attempt,
              Number.isFinite(seconds) ? seconds * 1000 : 0,
            ),
          ),
        );
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw error(
          502,
          {
            401: "FlowUs 密钥无效或已过期，请重新配置。",
            403: "FlowUs 拒绝访问，请核对专业版权益、只读权限和页面授权范围。",
            404: "FlowUs 页面不可访问，请核对页面 ID 和授权。",
            429: "FlowUs 请求频率受限，请稍后重试。",
          }[response.status] || "FlowUs 读取失败，请稍后重试。",
        );
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          await response.body.cancel().catch(() => {});
          throw error(422, "FlowUs 返回内容超过单次读取上限。");
        }
        chunks.push(chunk);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw error(502, "FlowUs 返回格式无效。");
      }
    }
  }
  async list(route, body) {
    const result = [],
      seen = new Set();
    let cursor;
    do {
      const value = await this.call(
        body
          ? route
          : route +
              "?page_size=100" +
              (cursor ? "&start_cursor=" + encodeURIComponent(cursor) : ""),
        body
          ? {
              ...body,
              page_size: 100,
              ...(cursor ? { start_cursor: cursor } : {}),
            }
          : undefined,
      );
      if (!Array.isArray(value.results))
        throw error(502, "FlowUs 列表返回格式无效。");
      result.push(...value.results);
      if (result.length > 2000)
        throw error(422, "目录或正文过大，请拆分发布范围。");
      if (!value.has_more) return result;
      cursor = value.next_cursor;
      if (!cursor || seen.has(cursor))
        throw error(502, "FlowUs 分页未完成，本次同步已停止。");
      seen.add(cursor);
    } while (true);
  }
}
