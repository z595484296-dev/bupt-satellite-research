import React, { useState, useEffect } from "react";
import { request } from "./App.jsx";
import { Body, Attachments } from "./ArticleBody.jsx";

const emptySource = () => ({
  type: "page",
  id: "",
  kind: "insight",
  publishField: "官网发布",
});
export default function FlowusAdmin({ onUpdate }) {
  const [status, setStatus] = useState(null),
    [config, setConfig] = useState(null),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState(""),
    [discovered, setDiscovered] = useState([]);
  async function refresh() {
    const data = await request("/api/admin/flowus");
    setStatus(data);
    setConfig((old) => old || { ...data.config, sources: data.config.sources });
    return data;
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(
      () =>
        refresh()
          .then((s) => {
            if (status.running && !s.running) onUpdate();
          })
          .catch((e) => setError(e.message)),
      status.running || status.mirror?.running ? 2000 : 15000,
    );
    return () => clearTimeout(timer);
  }, [status]);
  async function action(fn) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const post = (route, body = {}) =>
    request("/api/admin/flowus/" + route, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const locked = busy || status?.running;
  const candidate = status?.candidates.find((c) => c.revision === selected);
  const previewUrl = (url) =>
    "/api/admin/flowus/media/" +
    candidate.revision +
    "/" +
    url.split("/").at(-1);
  const editSource = (i, key, value) =>
    setConfig((c) => ({
      ...c,
      sources: c.sources.map((s, j) => (i === j ? { ...s, [key]: value } : s)),
    }));
  return (
    <div className="flowus-admin">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">FLOWUS</p>
          <h1>内容同步</h1>
          <p>在 FlowUs 更新，在网站完整呈现。</p>
        </div>
        <span className="sync-badge">
          {status?.config.hasConnection
            ? status.config.tokenSource === "cli"
              ? "已配置浏览器授权"
              : "已配置密钥"
            : "待连接"}
        </span>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {status?.mirror?.enabled && (
        <section className="sync-panel sites-sync-panel">
          <div className="sync-toolbar">
            <div>
              <h2>Sites 云端网站</h2>
              <p>
                本地服务运行时，每分钟检查已公开内容的变化，正文、图片和附件一起同步。云端合作留言会自动收回本地后台。
              </p>
            </div>
            <a
              className="button secondary"
              href={status.mirror.url}
              target="_blank"
              rel="noreferrer"
            >
              打开云端网站
            </a>
          </div>
          <p role="status">
            {status.mirror.running
              ? "正在同步到 Sites…"
              : status.mirror.error ||
                (status.mirror.lastSuccess
                  ? `最近校验：${new Date(status.mirror.lastSuccess).toLocaleString("zh-CN")} · ${status.mirror.entries} 篇内容`
                  : "等待首次同步")}
          </p>
          <button
            className="button secondary"
            disabled={locked || status.mirror.running}
            onClick={() =>
              action(async () => {
                const result = await request("/api/admin/sites/sync", {
                  method: "POST",
                  body: "{}",
                });
                if (result.error) throw new Error(result.error);
                setMessage(
                  result.running
                    ? "Sites 同步正在进行。"
                    : "Sites 内容校验完成。",
                );
              })
            }
          >
            立即同步到 Sites
          </button>
        </section>
      )}
      {!config ? (
        <p>正在读取同步设置…</p>
      ) : (
        <>
          <section className="sync-panel">
            <h2>连接与发布范围</h2>
            <p className="field-help">
              先连接内容目录，再选择下面的页面或多维表及其对应的网站栏目。目录本身不会被发布成一篇文章。
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await post("config", { ...config, token });
                  setToken("");
                  setMessage("配置已保存。测试连接后，点击立即同步即可开始。");
                });
              }}
            >
              <fieldset disabled={locked}>
                <label>
                  内容目录链接或 UUID
                  <input
                    value={config.discoveryRoot || ""}
                    onChange={(e) =>
                      setConfig({ ...config, discoveryRoot: e.target.value })
                    }
                    placeholder="研究中心主页的 FlowUs 链接"
                  />
                </label>
                {status.config.tokenSource === "cli" ? (
                  <p className="field-help">
                    使用服务器已保存的 FlowUs
                    浏览器授权，无需在这里粘贴密钥。点击“测试连接”可核验当前空间与访问权限。
                  </p>
                ) : (
                  <>
                    <label>
                      FlowUs API 访问令牌
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder={
                          status.config.hasToken
                            ? "已配置；留空保留原密钥"
                            : "粘贴有效的 API 访问令牌"
                        }
                        maxLength={4096}
                      />
                    </label>
                    <p className="field-help">
                      密钥只保存在此网站服务器，不会显示在公开页面。
                      {status.config.tokenSource === "environment" &&
                        "当前使用服务器 FLOWUS_TOKEN；请在服务器更换密钥。"}
                    </p>
                  </>
                )}
                <button
                  type="button"
                  className="button secondary"
                  disabled={
                    !status.config.hasConnection || !status.config.discoveryRoot
                  }
                  onClick={() =>
                    action(async () => {
                      const r = await post("discover");
                      setDiscovered(r.sources);
                      setMessage(
                        `已识别「${r.title || "内容目录"}」下的 ${r.sources.length} 个页面或多维表。添加所需来源后保存配置。` +
                          (r.warnings || []).join(" "),
                      );
                    })
                  }
                >
                  识别已保存的目录
                </button>
                {discovered.length > 0 && (
                  <div className="sync-discovered">
                    {discovered.map((s) => (
                      <div className="sync-row" key={s.id}>
                        <span>
                          <strong>{s.title}</strong>
                          <small>
                            {s.type === "database" ? "多维表" : "页面"}
                            {s.linked ? " · 链接引用，请确认适合公开" : ""}
                          </small>
                        </span>
                        <button
                          type="button"
                          disabled={
                            config.sources.some((x) => x.id === s.id) ||
                            config.sources.length >= 20
                          }
                          onClick={() =>
                            setConfig((c) => ({
                              ...c,
                              sources: [
                                ...c.sources,
                                { ...emptySource(), id: s.id, type: s.type },
                              ],
                            }))
                          }
                        >
                          {config.sources.some((x) => x.id === s.id)
                            ? "已添加"
                            : "添加"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {config.sources.map((s, i) => (
                  <div className="sync-source" key={i}>
                    <div className="sync-source-top">
                      <strong>来源 {i + 1}</strong>
                      {config.sources.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setConfig((c) => ({
                              ...c,
                              sources: c.sources.filter((_, j) => i !== j),
                            }))
                          }
                        >
                          移除此来源
                        </button>
                      )}
                    </div>
                    <div className="sync-fields">
                      <label>
                        来源类型
                        <select
                          value={s.type}
                          onChange={(e) =>
                            editSource(i, "type", e.target.value)
                          }
                        >
                          <option value="page">单篇页面</option>
                          <option value="database">多维表</option>
                        </select>
                      </label>
                      <label>
                        网站栏目
                        <select
                          value={s.kind}
                          onChange={(e) =>
                            editSource(i, "kind", e.target.value)
                          }
                        >
                          <option value="insight">观点洞察</option>
                          <option value="research">研究与成果</option>
                          <option value="news">中心动态</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      {s.type === "database"
                        ? "多维表原始链接或 UUID（不是视图链接）"
                        : "页面链接或 UUID"}
                      <input
                        required
                        value={s.id}
                        onChange={(e) => editSource(i, "id", e.target.value)}
                        placeholder="https://flowus.cn/…"
                      />
                    </label>
                    {s.type === "database" && (
                      <>
                        <label>
                          该表同步范围
                          <select
                            value={
                              s.publishAll
                                ? "all"
                                : s.publishValue !== undefined
                                  ? "match"
                                  : "checkbox"
                            }
                            onChange={(e) =>
                              setConfig((c) => ({
                                ...c,
                                sources: c.sources.map((item, j) =>
                                  j !== i
                                    ? item
                                    : {
                                        ...item,
                                        publishAll: e.target.value === "all",
                                        publishField:
                                          e.target.value === "match"
                                            ? "状态"
                                            : "官网发布",
                                        publishValue:
                                          e.target.value === "match"
                                            ? "研究中心"
                                            : undefined,
                                      },
                                ),
                              }))
                            }
                          >
                            <option value="checkbox">仅勾选发布的记录</option>
                            <option value="match">
                              仅匹配指定状态或标签的记录
                            </option>
                            <option value="all">
                              整表同步（此表专供公开）
                            </option>
                          </select>
                        </label>
                        {!s.publishAll && (
                          <label>
                            {s.publishValue !== undefined
                              ? "发布状态或标签字段名"
                              : "发布复选框字段名"}
                            <input
                              required
                              value={s.publishField}
                              maxLength={80}
                              onChange={(e) =>
                                editSource(i, "publishField", e.target.value)
                              }
                            />
                          </label>
                        )}
                        {!s.publishAll && s.publishValue !== undefined && (
                          <label>
                            自动发布的状态或标签值
                            <input
                              required
                              value={s.publishValue}
                              maxLength={80}
                              onChange={(e) =>
                                editSource(i, "publishValue", e.target.value)
                              }
                            />
                          </label>
                        )}
                      </>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="sync-add"
                  disabled={config.sources.length >= 20}
                  onClick={() =>
                    setConfig((c) => ({
                      ...c,
                      sources: [...c.sources, emptySource()],
                    }))
                  }
                >
                  ＋ 添加来源
                </button>
                <div className="sync-fields">
                  <label>
                    检查频率
                    <select
                      value={config.intervalMinutes}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          intervalMinutes: Number(e.target.value),
                        })
                      }
                    >
                      <option value={5}>每 5 分钟</option>
                      <option value={15}>每 15 分钟</option>
                      <option value={60}>每小时</option>
                      <option value={0}>仅手动同步</option>
                    </select>
                  </label>
                  <label>
                    发布方式
                    <select
                      value={String(config.autoPublish)}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          autoPublish: e.target.value === "true",
                        })
                      }
                    >
                      <option value="true">同步成功后自动发布</option>
                      <option value="false">先预览，由管理员发布</option>
                    </select>
                  </label>
                </div>
                <p className="field-help">
                  取消发布勾选、改为不匹配的状态或移除指定标签，或将已同步的
                  FlowUs
                  页面移入回收站，网站会在下次成功同步时下架。移除本页来源配置仅停止同步，已发布内容请在内容库下架。
                </p>
                <button className="button" disabled={locked}>
                  保存配置
                </button>
              </fieldset>
            </form>
          </section>
          <section className="sync-panel">
            <div className="sync-toolbar">
              <div>
                <h2>同步状态</h2>
                <p aria-live="polite">
                  {status.running
                    ? status.progress || "正在处理…"
                    : status.lastRun
                      ? "上次检查：" +
                        new Date(status.lastRun.at).toLocaleString("zh-CN")
                      : "尚未同步。保存配置后可测试连接。"}
                </p>
              </div>
              <div className="sync-buttons">
                <button
                  className="button secondary"
                  disabled={locked || !status.config.hasConnection}
                  onClick={() =>
                    action(async () => {
                      const r = await post("connection");
                      setMessage(
                        "已连接：" +
                          r.workspace +
                          (r.warning ? "。" + r.warning : ""),
                      );
                    })
                  }
                >
                  测试连接
                </button>
                <button
                  className="button"
                  disabled={
                    locked ||
                    !status.config.hasConnection ||
                    !status.config.sources.length
                  }
                  onClick={() =>
                    action(async () => {
                      await post("sync");
                      setMessage("已开始同步，结果会自动更新。");
                    })
                  }
                >
                  {status.running ? "同步中…" : "立即同步"}
                </button>
              </div>
            </div>
            {status.lastRun && (
              <>
                <p className="sync-counts">
                  已发布 {status.lastRun.published}　未变化{" "}
                  {status.lastRun.unchanged}　待处理 {status.lastRun.pending}
                  　已下架 {status.lastRun.withdrawn}
                </p>
                {status.lastRun.errors.map((e, i) => (
                  <p className="error sync-error" key={i}>
                    {e.message}
                    {e.source && <small>来源 ID：{e.source}</small>}
                  </p>
                ))}
              </>
            )}
          </section>
          <section className="sync-panel">
            <h2>
              {status.config.autoPublish ? "需要处理的内容" : "待发布内容"}
            </h2>
            {!status.candidates.length ? (
              <p className="field-help">
                没有待处理内容。自动发布成功的文章会出现在网站和内容库中。
              </p>
            ) : (
              status.candidates.map((c) => (
                <button
                  className="sync-row"
                  key={c.revision}
                  onClick={() => setSelected(c.revision)}
                >
                  <span>
                    <strong>{c.entry.title}</strong>
                    <small>
                      {c.issues.length
                        ? "需在 FlowUs 调整后重试"
                        : "查看同步预览"}{" "}
                      · {c.assets.length} 个文件
                    </small>
                  </span>
                  <span>查看</span>
                </button>
              ))
            )}
          </section>
          {candidate && (
            <section className="sync-panel sync-preview">
              <div className="sync-toolbar">
                <h2>同步预览</h2>
                <button onClick={() => setSelected("")}>关闭预览</button>
              </div>
              <p className="field-help">
                读取于 {new Date(candidate.syncedAt).toLocaleString("zh-CN")}
                ，当前仅管理员可见。
              </p>
              {candidate.issues.map((issue, i) => (
                <p className="error" key={i}>
                  {issue}
                </p>
              ))}
              <h3>{candidate.entry.title}</h3>
              <Body text={candidate.entry.body} mediaUrl={previewUrl} />
              <Attachments
                items={candidate.entry.attachments}
                mediaUrl={previewUrl}
              />
              <button
                className="button"
                disabled={locked || candidate.issues.length > 0}
                onClick={() =>
                  action(async () => {
                    await post("publish", { revision: candidate.revision });
                    setSelected("");
                    setMessage("内容已发布到网站。");
                    onUpdate();
                  })
                }
              >
                发布这一版
              </button>
            </section>
          )}
          <details className="sync-panel">
            <summary>最近的发布记录</summary>
            {status.history.length ? (
              status.history.slice(0, 15).map((h, i) => (
                <div className="sync-history" key={i}>
                  <strong>{h.title}</strong>
                  <span>
                    {h.action === "published" ? "已发布" : "已下架"} ·{" "}
                    {new Date(h.at).toLocaleString("zh-CN")}
                  </span>
                </div>
              ))
            ) : (
              <p>连接后，这里会记录每次发布与下架。</p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
