import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomic-file.mjs";
import path from "node:path";
import { initialContent } from "./seed.mjs";
export const dataDir = path.resolve(process.env.DATA_DIR || "data");
export const mediaDir = path.join(dataDir, "uploads");
let queue = Promise.resolve();
export async function initStorage() {
  await mkdir(mediaDir, { recursive: true });
  await mkdir(path.join(dataDir, "backups"), { recursive: true });
  for (const [name, value] of [
    ["content.json", initialContent],
    ["inquiries.json", []],
  ]) {
    try {
      await writeFile(
        path.join(dataDir, name),
        JSON.stringify(value, null, 2),
        { flag: "wx", mode: 0o600 },
      );
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}
export async function readData(name) {
  return JSON.parse(await readFile(path.join(dataDir, name), "utf8"));
}
export function mutateData(name, fn) {
  const work = queue.then(async () => {
    const old = await readData(name);
    const next = await fn(old);
    if (next === old) return old;
    const dest = path.join(dataDir, name);
    if (name === "content.json")
      await copyFile(
        dest,
        path.join(
          dataDir,
          "backups",
          `content-${Date.now()}-${randomUUID()}.json`,
        ),
      );
    await atomicWriteJson(dest, next);
    return next;
  });
  queue = work.catch(() => {});
  return work;
}
export const error = (status, message) =>
  Object.assign(new Error(message), { status });
export function validateEntry(raw) {
  if (!raw || typeof raw !== "object") throw error(400, "内容格式无效。");
  if (!["research", "insight", "news"].includes(raw.kind))
    throw error(400, "请选择有效的内容类型。");
  if (!["draft", "published"].includes(raw.status))
    throw error(400, "无效的发布状态。");
  const out = {};
  for (const [key, max] of Object.entries({
    title: 180,
    subtitle: 240,
    summary: 800,
    body: 50000,
    category: 40,
    format: 40,
    channel: 80,
    author: 100,
    date: 10,
    cover: 250,
    attachment: 250,
    sourceUrl: 1500,
  })) {
    out[key] = String(raw[key] ?? "").trim();
    if (out[key].length > max) throw error(400, `${key} 内容过长。`);
  }
  if (!out.title) throw error(400, "请填写标题。");
  if (out.date && !/^\d{4}-\d{2}(?:-\d{2})?$/.test(out.date))
    throw error(400, "日期格式应为 YYYY-MM 或 YYYY-MM-DD。");
  if (out.sourceUrl) {
    try {
      if (new URL(out.sourceUrl).protocol !== "https:") throw 0;
    } catch {
      throw error(400, "来源链接必须使用有效的 HTTPS 地址。");
    }
  }
  for (const key of ["cover", "attachment"])
    if (out[key] && !/^\/media\/[a-f0-9-]+\.(png|jpg|webp|pdf)$/.test(out[key]))
      throw error(400, "请通过上传按钮添加文件。");
  if (out.cover.endsWith(".pdf")) throw error(400, "封面必须是图片。");
  if (out.attachment && !out.attachment.endsWith(".pdf"))
    throw error(400, "附件必须是 PDF。");
  return {
    ...out,
    kind: raw.kind,
    status: raw.status,
    featured: !!raw.featured,
  };
}
export function validateInquiry(raw) {
  if (!raw || typeof raw !== "object") throw error(400, "留言格式无效。");
  const out = {};
  for (const [key, max] of Object.entries({
    name: 60,
    organization: 160,
    email: 254,
    direction: 30,
    message: 2000,
  })) {
    out[key] = String(raw[key] ?? "").trim();
    if (out[key].length > max) throw error(400, "填写内容超出长度限制。");
  }
  if (!out.name || !out.message) throw error(400, "请填写姓名和合作需求。");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
    throw error(400, "请填写有效的联系邮箱。");
  if (!["联合研究", "产业交流", "学术研讨", "其他合作"].includes(out.direction))
    throw error(400, "请选择合作方向。");
  return out;
}
