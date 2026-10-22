import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { visit } from "unist-util-visit";
import { downloadAsset } from "./flowus-client.mjs";
import { error } from "./storage.mjs";

export const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
export const plain = (rich) =>
  Array.isArray(rich)
    ? rich.map((x) => x.plain_text ?? x.text?.content ?? "").join("")
    : "";
export const property = (page, name) => {
  const p = page.properties?.[name];
  if (!p) return "";
  return (
    plain(p.rich_text || p.title) ||
    p.select?.name ||
    p.multi_select?.map((item) => item.name).join("、") ||
    p.status?.name ||
    p.date?.start?.slice(0, 10).replaceAll("/", "-") ||
    p.url ||
    ""
  );
};
const fileUrl = (f) => f?.file?.url || f?.external?.url;
const identity = (raw) => {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw;
  }
};
const types = new Set([
  "png",
  "jpg",
  "webp",
  "gif",
  "avif",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
]);
export const syncMediaPattern =
  /^\/media\/([a-f0-9]{64}\.(?:png|jpg|webp|gif|avif|pdf|docx|xlsx|pptx))$/;
export const isImage = (ext) =>
  ["png", "jpg", "webp", "gif", "avif"].includes(ext);

export async function preparePage({
  client,
  page,
  stageDir,
  download = downloadAsset,
}) {
  const md = await client.call(`/pages/${page.id}/content/markdown`);
  if (
    page.last_edited_time &&
    md.last_edited_time &&
    Date.parse(page.last_edited_time) !== Date.parse(md.last_edited_time)
  )
    throw error(409, "FlowUs 正在编辑此文，请下一轮同步时重试。");
  if (typeof md.markdown !== "string" || md.markdown.length > 50000)
    throw error(422, "正文为空格式或超过 50,000 字符，请拆分文章。");
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkStringify);
  const tree = processor.parse(md.markdown),
    issues = [],
    assets = [],
    attachments = [],
    blocks = [];
  let blockCount = 0;
  async function walk(id, depth = 0, ancestors = new Set()) {
    if (depth > 12 || ancestors.has(id))
      throw error(422, "正文层级过深或出现循环引用。");
    const next = new Set([...ancestors, id]);
    const children = await client.list(`/blocks/${id}/children`);
    for (const b of children) {
      if (++blockCount > 2000) throw error(422, "正文区块过多，请拆分文章。");
      if (b.in_trash) continue;
      blocks.push(b);
      // A linked or child page is a distinct publication scope, never crawled.
      if (
        b.has_children &&
        ![
          "child_page",
          "child_database",
          "link_to_page",
          "link_page",
          "folder",
        ].includes(b.type)
      )
        await walk(b.id, depth + 1, next);
    }
  }
  await walk(page.id);
  const referencedFiles = new Map();
  const exportUrls = [];
  visit(tree, (node) => {
    if (["image", "link", "definition"].includes(node.type) && node.url)
      exportUrls.push(node.url);
  });
  const exportedFileUrl = (f) => {
    const direct = fileUrl(f);
    if (direct) return direct;
    const key = f?.file?.oss_name;
    if (!key || !key.startsWith("oss/")) return undefined;
    return exportUrls.find((raw) => {
      try {
        const url = new URL(raw);
        return (
          url.protocol === "https:" &&
          decodeURIComponent(url.pathname) === "/" + key
        );
      } catch {
        return false;
      }
    });
  };
  for (const b of blocks) {
    if (b.type === "file" || b.type === "image") {
      const f = b[b.type],
        url = exportedFileUrl(f);
      if (!url) {
        issues.push("有文件未返回下载地址，请检查 FlowUs 文件权限。");
        continue;
      }
      referencedFiles.set(identity(url), {
        url,
        name: plain(f.caption),
        image: b.type === "image" || f.display === "image",
      });
    }
  }
  // Database attachment properties are also part of the approved page.
  for (const p of Object.values(page.properties || {}))
    if (p.type === "files") {
      for (const f of p.files || []) {
        const url = exportedFileUrl(f);
        if (url)
          referencedFiles.set(identity(url), {
            url,
            name: f.name || "",
            image: false,
          });
        else issues.push("有附件未返回下载地址，请检查 FlowUs 文件权限。");
      }
    }
  await mkdir(stageDir, { recursive: true });
  const cache = new Map();
  let totalBytes = 0;
  async function mirror(url, name, expectImage) {
    const key = identity(url);
    if (cache.has(key)) return cache.get(key);
    if (assets.length >= 50) throw error(422, "每篇最多同步 50 个文件。");
    const bytes = await download(url);
    totalBytes += bytes.length;
    if (bytes.length > 20 * 1024 * 1024 || totalBytes > 100 * 1024 * 1024)
      throw error(422, "文件大小超过限制：单文件 20 MB，每篇共 100 MB。");
    let type;
    try {
      type = await fileTypeFromBuffer(bytes);
    } catch {}
    if (!type || !types.has(type.ext) || (expectImage && !isImage(type.ext)))
      throw error(
        422,
        "文件类型不支持或与内容不符。支持常见图片、PDF、DOCX、XLSX、PPTX。",
      );
    const filename = hash(bytes) + "." + type.ext;
    await writeFile(path.join(stageDir, filename), bytes, { mode: 0o600 });
    const item = {
      url: "/media/" + filename,
      name: (
        name || (expectImage ? "正文图片" : "附件") + "." + type.ext
      ).slice(0, 180),
      size: bytes.length,
      type: type.ext,
    };
    assets.push(item);
    cache.set(key, item);
    return item;
  }
  const nodes = [];
  visit(tree, (node) => {
    if (
      [
        "image",
        "link",
        "imageReference",
        "linkReference",
        "html",
        "definition",
      ].includes(node.type)
    )
      nodes.push(node);
  });
  const definitions = new Map(
    nodes.filter((x) => x.type === "definition").map((x) => [x.identifier, x]),
  );
  for (const node of nodes) {
    if (node.type === "html") {
      issues.push(
        "正文含 HTML 或暂不支持的 FlowUs 区块。请在 FlowUs 转换为普通正文后重新同步。",
      );
      continue;
    }
    if (["imageReference", "linkReference"].includes(node.type)) {
      const def = definitions.get(node.identifier);
      if (!def) {
        issues.push("正文有未解析的引用链接。");
        continue;
      }
      node.type = node.type === "imageReference" ? "image" : "link";
      node.url = def.url;
      node.title = def.title;
      delete node.identifier;
      delete node.referenceType;
      delete node.label;
    }
    if (!["image", "link"].includes(node.type)) continue;
    const f = referencedFiles.get(identity(node.url));
    const fileExtension = /\.(pdf|docx|xlsx|pptx)(?:[?#]|$)/i.test(node.url);
    if (node.type === "image" || f || fileExtension) {
      const item = await mirror(
        f?.url || node.url,
        f?.name ||
          node.alt ||
          plain(node.children?.map((x) => ({ plain_text: x.value || "" }))),
        node.type === "image",
      );
      node.url = item.url;
      if (!isImage(item.type) && !attachments.some((x) => x.url === item.url))
        attachments.push(item);
    } else {
      try {
        const u = new URL(node.url);
        if (!["https:", "http:", "mailto:"].includes(u.protocol)) throw 0;
      } catch {
        issues.push("正文含无效或不支持的链接，请改成 HTTPS 链接。");
        node.url = "";
      }
    }
  }
  for (const f of referencedFiles.values()) {
    const item = await mirror(f.url, f.name, f.image);
    if (!isImage(item.type) && !attachments.some((x) => x.url === item.url))
      attachments.push(item);
    if (
      isImage(item.type) &&
      !nodes.some((n) => n.type === "image" && n.url === item.url)
    ) {
      issues.push("发现未能在正文定位的图片，请核对 FlowUs 导出结果后再发布。");
    }
  }
  // Remove unused definitions; they can contain expiring/private source URLs.
  tree.children = tree.children.filter((n) => n.type !== "definition");
  const body = processor.stringify(tree).trim();
  if (!body && !attachments.length)
    issues.push("正文和附件均为空，请在 FlowUs 补充内容。");
  if (body.length > 50000) throw error(422, "转换后的正文超过 50,000 字符。");
  return {
    body,
    assets,
    attachments,
    issues: [...new Set(issues)],
    editedAt: md.last_edited_time || page.last_edited_time || "",
  };
}
