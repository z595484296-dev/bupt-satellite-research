import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || "data");
const seedDir = path.join(root, "seed");
const mediaSource = path.join(seedDir, "media");
const contentPath = path.join(dataDir, "content.json");
const mediaTarget = path.join(dataDir, "uploads"); // server/storage.mjs uses DATA_DIR/uploads.
const filePattern = /^(?:[a-f0-9]{64}\.(?:png|jpg|webp|gif|avif|pdf|docx|xlsx|pptx)|[a-f0-9-]+\.(?:png|jpg|webp|pdf))$/;
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
};

async function info(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function rejectLinkedPath(file) {
  let current = path.parse(file).root;
  for (const segment of file.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const entry = await info(current);
    if (entry?.isSymbolicLink()) throw new Error("初始化路径不能经过符号链接或目录联接。");
  }
}

function inspectSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      !Number.isInteger(snapshot.version) || snapshot.version < 1 ||
      !snapshot.settings || typeof snapshot.settings !== "object" || Array.isArray(snapshot.settings) ||
      !Array.isArray(snapshot.entries)) throw new Error("公开快照格式无效：需要 version、settings、entries。");
  if (Object.keys(snapshot).some((key) => !["version", "settings", "entries"].includes(key))) {
    throw new Error("公开快照包含非预期顶层字段，请重新导出经过筛选的公开内容。");
  }
  const ids = new Set();
  for (const entry of snapshot.entries) {
    if (!entry || entry.status !== "published" || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)) {
      throw new Error("快照只能包含 ID 唯一的已发布条目。");
    }
    ids.add(entry.id);
  }
  const files = new Set();
  const forbidden = /^(?:flowus|token|password|hash|salt|admin|inquiries|candidates|sessions|credentials)$/i;
  function walk(value) {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\/media\/([a-zA-Z0-9%._/-]+)/g)) {
        if (!filePattern.test(match[1])) throw new Error("快照包含不安全或不支持的媒体路径。");
        files.add(match[1]);
      }
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (forbidden.test(key)) throw new Error("快照包含私有字段，请先移除账号、凭据或同步内部元数据。");
        walk(item);
      }
    }
  }
  walk(snapshot);
  return [...files].sort();
}

async function main() {
  if (path.resolve(process.cwd()) !== root) throw new Error("请先进入项目根目录，再运行初始化脚本。");
  if (inside(dataDir, root)) throw new Error("DATA_DIR 不能是项目根目录或它的上级目录。");
  for (const folder of ["src", "server", "scripts", "seed", "public", "docs", "design", "tests", "hosting", "worker", ".openai", ".git", "node_modules", "dist", ".runtime"]) {
    if (inside(path.join(root, folder), dataDir)) throw new Error("DATA_DIR 不能位于源码、种子、构建或运行状态目录内。");
  }
  await rejectLinkedPath(dataDir);
  if (await info(contentPath)) throw new Error("已有 content.json，拒绝覆盖。请使用新的 DATA_DIR，或跳过此步骤直接启动网站。");
  const targetInfo = await info(dataDir);
  if (targetInfo && (!targetInfo.isDirectory() || (await readdir(dataDir)).length)) {
    throw new Error("DATA_DIR 必须不存在或为空；初始化不会覆盖已有文件。请停止服务并选择新目录。");
  }

  const snapshotFile = path.join(seedDir, "public-content.json");
  await rejectLinkedPath(snapshotFile);
  if (!(await info(snapshotFile))?.isFile()) {
    throw new Error("缺少 seed/public-content.json。请取得完整交接包；也可跳过初始化，直接 npm run dev 使用基础示例。");
  }
  const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
  const files = inspectSnapshot(snapshot);
  await rejectLinkedPath(mediaSource);
  for (const name of files) {
    const source = path.join(mediaSource, name);
    if (!inside(mediaSource, source)) throw new Error("媒体路径超出 seed/media。");
    const sourceInfo = await info(source);
    if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) {
      throw new Error(`公开媒体缺失或不是普通文件：seed/media/${name}`);
    }
  }

  await mkdir(dataDir, { recursive: true });
  await rejectLinkedPath(dataDir);
  const lockPath = path.join(dataDir, ".public-demo-init.lock");
  const lock = await open(lockPath, "wx", 0o600);
  try {
    if (await info(contentPath)) throw new Error("初始化期间发现已有 content.json，已停止，未覆盖内容。");
    await mkdir(mediaTarget); // Refuse an existing uploads directory, including a symlink.
    for (const name of files) {
      await copyFile(path.join(mediaSource, name), path.join(mediaTarget, name), constants.COPYFILE_EXCL);
    }
    const output = await open(contentPath, "wx", 0o600);
    try { await output.writeFile(JSON.stringify(snapshot, null, 2) + "\n"); await output.sync(); }
    finally { await output.close(); }
    console.log(`公开演示内容初始化完成：${snapshot.entries.length} 条内容，${files.length} 个媒体文件。`);
    console.log("现在可运行 npm run dev，或 npm run build 后运行 npm start。首次账号由服务独立创建。");
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch((error) => {
  const message = error instanceof SyntaxError ? "公开快照不是有效 JSON，请重新获取。" :
    error.code === "EEXIST" ? "目标文件或目录已存在，拒绝覆盖；请确认服务停止，并使用新的空 DATA_DIR。" :
    error.code ? `文件操作失败（${error.code}），未覆盖已有文件；请检查交接包或使用新的空 DATA_DIR。` : error.message;
  console.error(`初始化未完成：${message}`);
  process.exitCode = 1;
});
