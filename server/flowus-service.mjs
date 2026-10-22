import {
  mkdir,
  writeFile,
  copyFile,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  dataDir,
  mediaDir,
  readData,
  mutateData,
  error,
  validateEntry,
} from "./storage.mjs";
import {
  cliEnabled,
  cliConfigured,
  configuredFlowusClient,
} from "./flowus-cli-client.mjs";
import {
  preparePage,
  hash,
  plain,
  property,
  syncMediaPattern,
} from "./flowus-content.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function pageId(value) {
  let raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw.startsWith("https://")) {
    let u;
    try {
      u = new URL(raw);
    } catch {}
    if (!u || !["flowus.cn", "www.flowus.cn"].includes(u.hostname))
      throw error(400, "请填写 FlowUs 页面链接或 UUID。");
    raw = u.pathname.split("/").filter(Boolean).at(-1) || "";
  }
  if (!uuid.test(raw)) throw error(400, "请填写有效的页面或多维表 UUID。");
  return raw;
}
export function validateConfig(raw) {
  const discoveryRoot = raw.discoveryRoot ? pageId(raw.discoveryRoot) : "";
  if (
    !Array.isArray(raw.sources) ||
    (!raw.sources.length && !discoveryRoot) ||
    raw.sources.length > 20
  )
    throw error(400, "请指定内容目录，或配置 1–20 个明确的同步来源。");
  const seen = new Set();
  const sources = raw.sources.map((s) => {
    if (
      !["page", "database"].includes(s.type) ||
      !["research", "insight", "news"].includes(s.kind)
    )
      throw error(400, "同步来源类型无效。");
    const id = pageId(s.id);
    if (seen.has(id)) throw error(400, "同步来源重复。");
    seen.add(id);
    const publishField = String(s.publishField || "官网发布").trim();
    if (!publishField || publishField.length > 80)
      throw error(400, "发布字段名称无效。");
    const publishValue =
      s.publishValue === undefined ? undefined : String(s.publishValue).trim();
    if (
      publishValue !== undefined &&
      (!publishValue || publishValue.length > 80)
    )
      throw error(400, "发布匹配值无效。");
    return {
      id,
      type: s.type,
      kind: s.kind,
      publishField,
      publishAll: s.publishAll === true,
      ...(publishValue === undefined ? {} : { publishValue }),
    };
  });
  if (![0, 5, 15, 60].includes(Number(raw.intervalMinutes)))
    throw error(400, "同步间隔无效。");
  return {
    discoveryRoot,
    sources,
    intervalMinutes: Number(raw.intervalMinutes),
    autoPublish: raw.autoPublish !== false,
  };
}
export const fingerprint = (entry) => hash(entry || null);
export const publicContent = (data) => ({
  ...data,
  entries: data.entries
    .filter((e) => e.status === "published")
    .map(({ flowus, ...e }) => e),
});
const defaultConfig = {
  discoveryRoot: "",
  sources: [],
  intervalMinutes: 5,
  autoPublish: true,
};

export async function createFlowusService({
  clientFactory = configuredFlowusClient,
  download,
} = {}) {
  const stageRoot = path.join(dataDir, "flowus-staging");
  await mkdir(stageRoot, { recursive: true });
  for (const [name, value] of [
    ["flowus-private.json", { ...defaultConfig, token: "" }],
    ["flowus-state.json", { candidates: [], history: [], lastRun: null }],
  ]) {
    try {
      await writeFile(path.join(dataDir, name), JSON.stringify(value), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  let running = false,
    operation = false,
    progress = "",
    lastStarted = 0;
  async function config() {
    return readData("flowus-private.json");
  }
  const tokenOf = (c) => process.env.FLOWUS_TOKEN || c.token;
  const connected = (c) => (cliEnabled() ? cliConfigured() : !!tokenOf(c));
  const sourceKey = (s) => s.type + ":" + s.id;
  async function cleanStage(revision) {
    if (!uuid.test(revision)) throw error(400, "同步版本无效。");
    const target = path.resolve(stageRoot, revision);
    if (!target.startsWith(path.resolve(stageRoot) + path.sep))
      throw error(400, "目录无效。");
    await rm(target, { recursive: true, force: true });
  }
  async function sweep() {
    const keep = new Set((await state()).candidates.map((c) => c.revision));
    for (const name of await readdir(stageRoot))
      if (uuid.test(name) && !keep.has(name)) await cleanStage(name);
  }
  async function state() {
    return readData("flowus-state.json");
  }
  async function status() {
    const activeAtRead = running || operation;
    const c = await config(),
      st = await state();
    return {
      config: {
        ...validateOrDefault(c),
        hasToken: !cliEnabled() && !!tokenOf(c),
        hasConnection: connected(c),
        tokenSource: cliEnabled()
          ? "cli"
          : process.env.FLOWUS_TOKEN
            ? "environment"
            : "local",
      },
      ...st,
      running: activeAtRead || running || operation,
      progress,
    };
  }
  const validateOrDefault = (c) => ({
    discoveryRoot: c.discoveryRoot || "",
    sources: c.sources,
    intervalMinutes: c.intervalMinutes,
    autoPublish: c.autoPublish,
  });
  async function exclusive(fn) {
    if (running || operation)
      throw error(409, "同步操作正在进行，请完成后重试。");
    operation = true;
    try {
      return await fn();
    } finally {
      operation = false;
    }
  }
  async function configure(raw) {
    return exclusive(async () => {
      const next = validateConfig(raw),
        token = String(raw.token || "").trim();
      if (token.length > 4096 || /[\r\n]/.test(token))
        throw error(400, "密钥格式无效。");
      await mutateData("flowus-private.json", (c) => ({
        ...next,
        token: raw.clearToken ? "" : token || c.token,
      }));
      // Candidates from an old scope can never be published after reconfiguration.
      await mutateData("flowus-state.json", (s) => ({ ...s, candidates: [] }));
      lastStarted = Date.now();
      await sweep();
      return { ok: true };
    });
  }
  async function connection() {
    return exclusive(async () => {
      const c = await config();
      if (!connected(c))
        throw error(
          400,
          "请先配置有效访问令牌，或在服务器连接 FlowUs 浏览器授权。",
        );
      const result = await clientFactory(tokenOf(c)).call("/users/me");
      const capabilities = result.capabilities || {};
      for (const needed of [
        "pages.read",
        "blocks.read",
        ...(c.sources.some((s) => s.type === "database")
          ? ["databases.read"]
          : []),
      ])
        if (capabilities[needed] !== true)
          throw error(400, "FlowUs 集成缺少所需只读权限：" + needed);
      return {
        workspace: String(result.workspace_name || "已授权空间"),
        warning: Object.keys(capabilities).some(
          (k) => k.endsWith(".write") && capabilities[k],
        )
          ? cliEnabled()
            ? "当前授权包含写权限；网站连接器仅调用读取接口。"
            : "该密钥含写权限，建议改用仅有读取权限的集成。"
          : "",
      };
    });
  }
  async function discover() {
    return exclusive(async () => {
      const c = await config();
      if (!c.discoveryRoot || !connected(c))
        throw error(400, "请先保存内容目录并配置 FlowUs 授权。");
      const client = clientFactory(tokenOf(c));
      const root = await client.call("/pages/" + c.discoveryRoot);
      const result = [],
        visited = new Set();
      let count = 0;
      async function walk(id, depth = 0) {
        if (depth > 8 || visited.has(id)) return;
        visited.add(id);
        for (const b of await client.list("/blocks/" + id + "/children")) {
          if (++count > 500)
            throw error(422, "目录过大，请改用更小的发布目录。");
          if (b.in_trash) continue;
          if (["child_page", "child_database", "folder"].includes(b.type)) {
            result.push({
              id: b.id,
              type: b.type === "child_database" ? "database" : "page",
              title: b[b.type]?.title || "未命名页面",
              linked: false,
            });
          } else if (["link_to_page", "link_page"].includes(b.type)) {
            const link = b[b.type],
              target = link.database_id || link.page_id;
            if (target) {
              const type = link.database_id ? "database" : "page";
              const metadata = await client.call(
                `/${type === "database" ? "databases" : "pages"}/${pageId(target)}`,
              );
              result.push({
                id: target,
                type,
                title:
                  plain(metadata.title) ||
                  plain(
                    Object.values(metadata.properties || {}).find(
                      (p) => p.type === "title",
                    )?.title,
                  ) ||
                  "链接页面",
                linked: true,
              });
            }
          } else if (b.has_children) await walk(b.id, depth + 1);
        }
      }
      await walk(c.discoveryRoot);
      // FlowUs may omit inline database views from block children while exposing
      // their actual database IDs in its own Markdown export. Verify every ID.
      const warnings = [];
      try {
        const markdown = await client.call(
          `/pages/${c.discoveryRoot}/content/markdown`,
        );
        const matches = [
          ...String(markdown.markdown || "").matchAll(
            /\[[^\]]*数据库[^\]]*\]\(https:\/\/(?:www\.)?flowus\.cn\/([a-f0-9-]{36})\)/g,
          ),
        ];
        if (matches.length > 50)
          throw error(422, "目录引用过多，请缩小内容目录。");
        for (const [, id] of matches) {
          if (result.some((s) => s.id === id)) continue;
          const db = await client.call("/databases/" + pageId(id));
          result.push({
            id,
            type: "database",
            title: plain(db.title) || "内嵌多维表",
            linked: true,
          });
        }
      } catch {
        warnings.push("部分内嵌多维表未能识别，可使用多维表原始链接单独添加。");
      }
      return {
        title: plain(
          Object.values(root.properties || {}).find((p) => p.type === "title")
            ?.title,
        ),
        sources: result.filter(
          (s, i, a) => a.findIndex((x) => x.id === s.id) === i,
        ),
        warnings,
      };
    });
  }
  function available(page, source) {
    if (page.in_trash) return false;
    if (source.type === "page") return true;
    if (page.parent?.database_id !== source.id)
      throw error(422, "页面不属于指定多维表，已停止发布。");
    if (source.publishAll) return true;
    const field = page.properties?.[source.publishField];
    if (source.publishValue !== undefined) {
      if (!field || !["select", "status", "multi_select"].includes(field.type))
        throw error(
          422,
          `多维表需有「${source.publishField}」单选、状态或多选字段，已停止发布。`,
        );
      if (field.type === "multi_select")
        return field.multi_select.some(
          (item) => item.name === source.publishValue,
        );
      return field[field.type]?.name === source.publishValue;
    }
    if (!field || field.type !== "checkbox")
      throw error(
        422,
        `多维表需有「${source.publishField}」复选框字段，勾选才会同步。`,
      );
    return field.checkbox === true;
  }
  function findEntry(content, id) {
    return content.entries.find(
      (e) =>
        e.flowus?.pageId === id ||
        e.sourceUrl
          ?.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0]
          ?.toLowerCase() === id,
    );
  }
  async function candidate(client, page, source) {
    const content = await readData("content.json"),
      existing = findEntry(content, page.id);
    const revision = randomUUID();
    let prepared;
    try {
      prepared = await preparePage({
        client,
        page,
        stageDir: path.join(stageRoot, revision),
        download,
      });
    } catch (e) {
      await cleanStage(revision);
      throw e;
    }
    const title = plain(
      Object.values(page.properties || {}).find((p) => p.type === "title")
        ?.title,
    );
    const category =
      property(page, "分类") ||
      (source.kind === "news" ? property(page, "活动类型") : "");
    const entry = validateEntry({
      ...(existing || {}),
      kind: existing?.kind || source.kind,
      status: "published",
      title,
      body: prepared.body,
      summary: property(page, "摘要") || existing?.summary || "",
      author: property(page, "作者") || existing?.author || "",
      category: category || existing?.category || "",
      date:
        property(page, "发布日期") ||
        property(page, "时间") ||
        existing?.date ||
        "",
    });
    // Include only source-owned values in the change signature. Website cover,
    // featured flags and editorial metadata remain controlled by the website.
    const digest = hash({
      title,
      body: prepared.body,
      attachments: prepared.attachments,
      summary: property(page, "摘要"),
      author: property(page, "作者"),
      category,
      date: property(page, "发布日期") || property(page, "时间"),
    });
    return {
      revision,
      pageId: page.id,
      entryId: existing?.id || "flowus-" + page.id,
      sourceKey: sourceKey(source),
      entry: { ...entry, attachments: prepared.attachments },
      assets: prepared.assets,
      issues: prepared.issues,
      digest,
      base: fingerprint(existing),
      sourceEditedAt: prepared.editedAt,
      syncedAt: new Date().toISOString(),
    };
  }
  async function publish(c, { verify = true, client, source } = {}) {
    if (c.issues.length)
      throw error(422, "内容有待处理的问题，修正后重新同步即可。");
    if (verify) {
      const configValue = await config();
      source = configValue.sources.find((s) => sourceKey(s) === c.sourceKey);
      if (!source || !connected(configValue))
        throw error(409, "同步来源或授权已变更，请重新同步。");
      client = clientFactory(tokenOf(configValue));
      const page = await client.call("/pages/" + c.pageId);
      if (!available(page, source))
        throw error(409, "该内容已不在 FlowUs 发布范围内。");
      const fresh = await candidate(client, page, source);
      await cleanStage(fresh.revision);
      if (fresh.digest !== c.digest || fresh.issues.length)
        throw error(409, "FlowUs 内容已变化，请重新同步后发布。");
    }
    for (const a of c.assets) {
      const match = a.url.match(syncMediaPattern);
      if (!match) throw error(422, "同步文件记录无效。");
      await copyFile(
        path.join(stageRoot, c.revision, match[1]),
        path.join(mediaDir, match[1]),
      );
    }
    let previous;
    await mutateData("content.json", (old) => {
      const entry = old.entries.find((e) => e.id === c.entryId);
      if (entry?.flowus?.revision === c.revision) return old;
      if (fingerprint(entry) !== c.base)
        throw error(409, "网站文章已被修改，请重新同步以避免覆盖。");
      previous = entry || null;
      const next = {
        ...c.entry,
        id: c.entryId,
        updatedAt: new Date().toISOString(),
        flowus: {
          pageId: c.pageId,
          sourceKey: c.sourceKey,
          digest: c.digest,
          revision: c.revision,
          sourceEditedAt: c.sourceEditedAt,
        },
      };
      return {
        ...old,
        version: old.version + 1,
        entries: entry
          ? old.entries.map((e) => (e.id === next.id ? next : e))
          : [next, ...old.entries],
      };
    });
    await mutateData("flowus-state.json", (st) => ({
      ...st,
      candidates: st.candidates.filter((x) => x.pageId !== c.pageId),
      history: [
        {
          pageId: c.pageId,
          entryId: c.entryId,
          title: c.entry.title,
          revision: c.revision,
          at: new Date().toISOString(),
          action: "published",
          previous,
        },
        ...st.history,
      ].slice(0, 50),
    }));
    await cleanStage(c.revision);
  }
  async function withdraw(page, source) {
    let title = "",
      id = "";
    await mutateData("content.json", (old) => {
      const entry = findEntry(old, page.id);
      if (!entry || entry.status !== "published") return old;
      // Only content actually managed by this source can be withdrawn.
      if (entry.flowus?.sourceKey !== sourceKey(source)) return old;
      title = entry.title;
      id = entry.id;
      return {
        ...old,
        version: old.version + 1,
        entries: old.entries.map((e) =>
          e.id === id ? { ...e, status: "draft" } : e,
        ),
      };
    });
    await mutateData("flowus-state.json", (st) => ({
      ...st,
      candidates: st.candidates.filter((c) => c.pageId !== page.id),
      history: title
        ? [
            {
              pageId: page.id,
              entryId: id,
              title,
              action: "withdrawn",
              at: new Date().toISOString(),
            },
            ...st.history,
          ].slice(0, 50)
        : st.history,
    }));
    return !!title;
  }
  async function run() {
    if (running || operation) throw error(409, "同步操作正在进行。");
    running = true;
    let c;
    try {
      c = await config();
      if (!connected(c) || !c.sources.length)
        throw error(400, "请先配置 FlowUs 授权和同步来源。");
    } catch (e) {
      running = false;
      throw e;
    }
    lastStarted = Date.now();
    progress = "正在连接 FlowUs…";
    const report = {
      at: new Date().toISOString(),
      published: 0,
      unchanged: 0,
      pending: 0,
      withdrawn: 0,
      errors: [],
    };
    // A failure never reaches the HTTP logger with request/credential details.
    const task = (async () => {
      try {
        const client = clientFactory(tokenOf(c)),
          seen = new Set();
        for (const source of c.sources) {
          let pages;
          try {
            pages =
              source.type === "page"
                ? [await client.call("/pages/" + source.id)]
                : await client.list("/databases/" + source.id + "/query", {});
            if (pages.length > 200)
              throw error(422, "单个多维表最多同步 200 篇，请缩小发布库。");
            // Check known rows omitted by a query individually. Missing/error is
            // NOT equivalent to deletion. Only explicit trash/checkbox withdraws.
            const content = await readData("content.json");
            for (const entry of content.entries.filter(
              (e) => e.flowus?.sourceKey === sourceKey(source),
            )) {
              if (!pages.some((p) => p.id === entry.flowus.pageId))
                pages.push(await client.call("/pages/" + entry.flowus.pageId));
            }
          } catch (e) {
            report.errors.push({
              source: source.id,
              message: e.status ? e.message : "来源读取失败，请重试。",
            });
            continue;
          }
          for (const page of pages) {
            if (!uuid.test(page.id) || seen.has(page.id)) continue;
            seen.add(page.id);
            progress = `正在同步第 ${seen.size} 篇内容…`;
            try {
              if (!available(page, source)) {
                if (await withdraw(page, source)) report.withdrawn++;
                continue;
              }
              const next = await candidate(client, page, source);
              const content = await readData("content.json"),
                existing = findEntry(content, page.id);
              if (
                existing?.flowus?.digest === next.digest &&
                existing.status === "published" &&
                !next.issues.length
              ) {
                report.unchanged++;
                await mutateData("flowus-state.json", (st) => ({
                  ...st,
                  candidates: st.candidates.filter((x) => x.pageId !== page.id),
                }));
                await cleanStage(next.revision);
                continue;
              }
              await mutateData("flowus-state.json", (st) => ({
                ...st,
                candidates: [
                  next,
                  ...st.candidates.filter((x) => x.pageId !== page.id),
                ],
              }));
              if (c.autoPublish && !next.issues.length) {
                await publish(next, { verify: false });
                report.published++;
              } else report.pending++;
            } catch (e) {
              if (typeof e.code === "string" && /^E[A-Z]+$/.test(e.code))
                console.warn(
                  "FlowUs storage operation failed:",
                  e.code,
                  e.syscall || "",
                );
              report.errors.push({
                source: page.id,
                ...(typeof e.code === "string" && /^E[A-Z]+$/.test(e.code)
                  ? { code: e.code }
                  : {}),
                message: e.status
                  ? e.message
                  : "该条同步未完成，请重试并检查同步记录。",
              });
            }
          }
        }
      } catch {
        report.errors.push({ message: "同步未完成，请检查配置后重试。" });
      } finally {
        report.finishedAt = new Date().toISOString();
        await mutateData("flowus-state.json", (st) => ({
          ...st,
          lastRun: report,
        }));
        await sweep();
        running = false;
        progress = "";
      }
    })();
    task.catch(() => {
      running = false;
      progress = "同步记录保存失败，请检查服务器磁盘。";
    });
    return { started: true };
  }
  async function approve(revision) {
    return exclusive(async () => {
      const c = (await state()).candidates.find((x) => x.revision === revision);
      if (!c) throw error(409, "此同步版本已过期，请刷新列表。");
      await publish(c);
      return { ok: true };
    });
  }
  async function previewFile(revision, filename) {
    if (!uuid.test(revision) || !syncMediaPattern.test("/media/" + filename))
      throw error(404, "文件不存在。");
    const c = (await state()).candidates.find((x) => x.revision === revision);
    if (!c?.assets.some((a) => a.url === "/media/" + filename))
      throw error(404, "文件不存在。");
    return path.join(stageRoot, revision, filename);
  }
  const timer = setInterval(async () => {
    try {
      const c = await config();
      if (
        connected(c) &&
        c.sources.length &&
        c.intervalMinutes &&
        !running &&
        !operation &&
        Date.now() - lastStarted >= c.intervalMinutes * 60000
      )
        await run();
    } catch {
      /* State is surfaced by manual connection/sync actions. */
    }
  }, 15000);
  timer.unref();
  return {
    status,
    configure,
    connection,
    discover,
    run,
    approve,
    previewFile,
    close: () => clearInterval(timer),
  };
}
