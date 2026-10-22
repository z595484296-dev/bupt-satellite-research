import FlowusAdmin from "./FlowusAdmin.jsx";
import React, { useState, useEffect, useRef } from "react";
import {
  ArrowRight,
  UploadSimple,
  Plus,
  ArrowLeft,
  SignOut,
  CheckCircle,
} from "@phosphor-icons/react";
import { request, Link, Body } from "./App.jsx";
const names = { research: "研究成果", insight: "观点文章", news: "中心动态" };
const blank = {
  kind: "research",
  status: "draft",
  title: "",
  subtitle: "",
  summary: "",
  body: "",
  category: "",
  format: "",
  channel: "",
  author: "",
  date: "",
  cover: "",
  attachment: "",
  sourceUrl: "",
  featured: false,
};
export default function Admin({ onUpdate }) {
  const [logged, setLogged] = useState(null),
    [data, setData] = useState(null),
    [tab, setTab] = useState(() =>
      new URLSearchParams(window.location.search).get("tab") === "flowus"
        ? "FlowUs 同步"
        : "内容库",
    ),
    [editor, setEditor] = useState(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploads, setUploads] = useState(0),
    [inquiries, setInquiries] = useState([]),
    [kind, setKind] = useState("all");
  function handleError(e) {
    if (e.status === 401 && logged) {
      setLogged(false);
      setError("登录已过期，请重新登录。未保存的文章暂时保留在当前会话中。");
    } else setError(e.message);
  }
  async function load() {
    try {
      setData(await request("/api/admin/content"));
    } catch (e) {
      handleError(e);
    }
  }
  useEffect(() => {
    request("/api/admin/session")
      .then((x) => setLogged(x.authenticated))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (logged) load();
  }, [logged]);
  useEffect(() => {
    if (logged && tab === "合作意向")
      request("/api/admin/inquiries").then(setInquiries).catch(handleError);
  }, [tab, logged]);
  async function action(fn) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveEntry(status) {
    if (uploads || busy) return;
    await action(async () => {
      const next = await request("/api/admin/entries", {
        method: "POST",
        body: JSON.stringify({
          version: data.version,
          entry: { ...editor, status },
        }),
      });
      setData(next);
      setEditor(null);
      setMessage(
        status === "published"
          ? "内容已发布，前台已更新。"
          : "草稿已保存，仅在后台可见。",
      );
      onUpdate();
    });
  }
  if (logged === null)
    return <div className="empty">{error || "正在连接内容管理后台…"}</div>;
  if (!logged)
    return (
      <div className="admin-login">
        <Link href="/" className="back-link">
          <ArrowLeft />
          返回网站
        </Link>
        <div className="login-card">
          <p className="eyebrow">CONTENT STUDIO</p>
          <h1>内容管理</h1>
          <p>卫星互联网研究中心</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              action(async () => {
                await request("/api/admin/login", {
                  method: "POST",
                  body: JSON.stringify(Object.fromEntries(form)),
                });
                setLogged(true);
              });
            }}
          >
            <label>
              用户名
              <input
                name="username"
                autoComplete="username"
                defaultValue="admin"
                required
              />
            </label>
            <label>
              密码
              <input
                name="password"
                autoComplete="current-password"
                type="password"
                required
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {message && <p role="status">{message}</p>}
            <button className="button" disabled={busy}>
              {busy ? "正在登录…" : "登录后台"}
              <ArrowRight />
            </button>
          </form>
        </div>
      </div>
    );
  return (
    <div className="admin">
      <header className="admin-header">
        <Link href="/admin">
          <strong>研究中心</strong>
          <span>内容管理</span>
        </Link>
        <div>
          <Link href="/">查看网站</Link>
          <button
            disabled={uploads > 0}
            onClick={() =>
              action(async () => {
                await request("/api/admin/logout", {
                  method: "POST",
                  body: "{}",
                });
                setLogged(false);
                setData(null);
                setEditor(null);
              })
            }
          >
            <SignOut />
            退出登录
          </button>
        </div>
      </header>
      <div className="admin-shell">
        <aside aria-label="后台导航">
          {["内容库", "FlowUs 同步", "站点信息", "合作意向", "账号安全"].map(
            (x) => (
              <button
                key={x}
                disabled={uploads > 0}
                aria-current={x === tab ? "page" : undefined}
                onClick={() => {
                  setTab(x);
                  setEditor(null);
                  setMessage("");
                  setError("");
                }}
              >
                {x}
              </button>
            ),
          )}
          <a href="/api/admin/export" download>
            导出内容备份
          </a>
        </aside>
        <main className="admin-main">
          {error && (
            <div className="notice error" role="alert">
              {error}
              {error.includes("刷新") && (
                <button
                  onClick={() =>
                    action(async () => {
                      await load();
                      setMessage(
                        "已获取最新版本。请核对当前编辑内容后再保存。",
                      );
                    })
                  }
                >
                  获取最新版本
                </button>
              )}
            </div>
          )}
          {message && (
            <div className="notice" role="status">
              <CheckCircle />
              {message}
            </div>
          )}
          {!data ? (
            <p>正在加载内容…</p>
          ) : tab === "内容库" ? (
            editor ? (
              <>
                <div className="admin-heading">
                  <button
                    className="back-link"
                    disabled={uploads > 0}
                    onClick={() => setEditor(null)}
                  >
                    <ArrowLeft />
                    内容库
                  </button>
                  <span>{editor.id ? "编辑内容" : "新建内容"}</span>
                </div>
                <form
                  className="editor"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEntry(editor.status);
                  }}
                >
                  <div className="editor-main">
                    <Field
                      label="标题"
                      value={editor.title}
                      required
                      maxLength={180}
                      onChange={(v) => setEditor({ ...editor, title: v })}
                    />
                    <Field
                      label="副标题"
                      value={editor.subtitle}
                      maxLength={240}
                      onChange={(v) => setEditor({ ...editor, subtitle: v })}
                    />
                    <Field
                      label="摘要"
                      textarea
                      rows={3}
                      value={editor.summary}
                      maxLength={800}
                      onChange={(v) => setEditor({ ...editor, summary: v })}
                    />
                    <Field
                      label="正文"
                      textarea
                      rows={18}
                      value={editor.body}
                      maxLength={50000}
                      onChange={(v) => setEditor({ ...editor, body: v })}
                    />
                    <p className="field-help">
                      支持 Markdown
                      标题、列表、引用、表格、链接和已导入网站的图片。FlowUs
                      同步文章的正文建议在 FlowUs 中修改。
                    </p>
                    <details className="editor-preview">
                      <summary>预览正文排版</summary>
                      <h1>{editor.title || "文章标题"}</h1>
                      <Body text={editor.body} />
                    </details>
                  </div>
                  <div className="editor-side">
                    <label>
                      内容类型
                      <select
                        value={editor.kind}
                        onChange={(e) =>
                          setEditor({ ...editor, kind: e.target.value })
                        }
                      >
                        {Object.entries(names).map(([k, n]) => (
                          <option value={k} key={k}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field
                      label="分类"
                      value={editor.category}
                      maxLength={40}
                      onChange={(v) => setEditor({ ...editor, category: v })}
                    />
                    <Field
                      label={
                        editor.kind === "research" ? "成果形式" : "发布渠道"
                      }
                      value={
                        editor.kind === "research"
                          ? editor.format
                          : editor.channel
                      }
                      maxLength={40}
                      onChange={(v) =>
                        setEditor({
                          ...editor,
                          [editor.kind === "research" ? "format" : "channel"]:
                            v,
                        })
                      }
                    />
                    <Field
                      label="发布日期"
                      placeholder="2026-10-16 或 2026-10"
                      value={editor.date}
                      onChange={(v) => setEditor({ ...editor, date: v })}
                    />
                    <Field
                      label="作者"
                      value={editor.author}
                      maxLength={100}
                      onChange={(v) => setEditor({ ...editor, author: v })}
                    />
                    <Field
                      label="原文链接（HTTPS，请填写文章详情页）"
                      value={editor.sourceUrl}
                      type="url"
                      onChange={(v) => setEditor({ ...editor, sourceUrl: v })}
                    />
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={editor.featured}
                        onChange={(e) =>
                          setEditor({ ...editor, featured: e.target.checked })
                        }
                      />
                      首页 / 列表推荐
                    </label>
                    <Uploader
                      label="封面图片"
                      accept="image/png,image/jpeg,image/webp"
                      url={editor.cover}
                      onBusy={(v) =>
                        setUploads((n) => Math.max(0, n + (v ? 1 : -1)))
                      }
                      onChange={(url) =>
                        setEditor((x) => (x ? { ...x, cover: url } : null))
                      }
                    />
                    <Uploader
                      label="PDF 附件"
                      accept="application/pdf"
                      url={editor.attachment}
                      onBusy={(v) =>
                        setUploads((n) => Math.max(0, n + (v ? 1 : -1)))
                      }
                      onChange={(url) =>
                        setEditor((x) => (x ? { ...x, attachment: url } : null))
                      }
                    />
                    <div className="publish-actions">
                      <button
                        className="button"
                        type="button"
                        disabled={busy || uploads > 0 || !editor.title.trim()}
                        onClick={() => saveEntry("published")}
                      >
                        {busy ? "正在保存…" : "保存并发布"}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy || uploads > 0}
                        onClick={() => saveEntry("draft")}
                      >
                        {editor.status === "published"
                          ? "转为草稿（下架）"
                          : "保存草稿"}
                      </button>
                      <p className="field-help">
                        草稿不会显示在公开网站。已发布内容修改后，点击保存并发布生效。
                      </p>
                    </div>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div className="admin-heading">
                  <div>
                    <p className="eyebrow">CONTENT LIBRARY</p>
                    <h1>内容库</h1>
                    <p>让研究持续积累，让观点被看见。</p>
                  </div>
                  <button
                    className="button"
                    onClick={() => setEditor({ ...blank })}
                  >
                    <Plus />
                    新建内容
                  </button>
                </div>
                <div className="tabs">
                  <button
                    aria-pressed={kind === "all"}
                    onClick={() => setKind("all")}
                  >
                    全部内容
                  </button>
                  {Object.entries(names).map(([k, n]) => (
                    <button
                      key={k}
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="admin-entries">
                  {data.entries
                    .filter((e) => kind === "all" || e.kind === kind)
                    .map((e) => (
                      <button
                        className="admin-entry"
                        key={e.id}
                        onClick={() => setEditor({ ...e })}
                      >
                        <div>
                          <span className={"status " + e.status}>
                            {e.status === "published" ? "已发布" : "草稿"}
                          </span>
                          <span className="muted">
                            {names[e.kind]} · {e.category || "未分类"}
                          </span>
                          <h3>{e.title}</h3>
                          <small>{e.date || "未设置日期"}</small>
                        </div>
                        <ArrowRight />
                      </button>
                    ))}
                </div>
              </>
            )
          ) : tab === "FlowUs 同步" ? (
            <FlowusAdmin
              onUpdate={() => {
                load();
                onUpdate();
              }}
            />
          ) : tab === "站点信息" ? (
            <Settings
              data={data}
              busy={busy}
              onSave={(settings) =>
                action(async () => {
                  const next = await request("/api/admin/settings", {
                    method: "POST",
                    body: JSON.stringify({ version: data.version, settings }),
                  });
                  setData(next);
                  setMessage("站点信息已更新。");
                  onUpdate();
                })
              }
            />
          ) : tab === "合作意向" ? (
            <>
              <div className="admin-heading">
                <div>
                  <p className="eyebrow">CONVERSATIONS</p>
                  <h1>合作意向</h1>
                  <p>来自网站表单的留言，仅管理员可见。</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() =>
                    action(async () =>
                      setInquiries(await request("/api/admin/inquiries")),
                    )
                  }
                >
                  刷新
                </button>
              </div>
              {!inquiries.length ? (
                <div className="empty">尚未收到合作意向。</div>
              ) : (
                inquiries.map((i) => (
                  <article className="inquiry" key={i.id}>
                    <div className="section-heading">
                      <div>
                        <h2>
                          {i.name}
                          <small>{i.organization}</small>
                        </h2>
                        <a href={`mailto:${i.email}`}>{i.email}</a>
                      </div>
                      <select
                        aria-label={`${i.name}的处理状态`}
                        value={i.status}
                        onChange={(e) =>
                          action(async () =>
                            setInquiries(
                              await request("/api/admin/inquiries", {
                                method: "POST",
                                body: JSON.stringify({
                                  id: i.id,
                                  status: e.target.value,
                                }),
                              }),
                            ),
                          )
                        }
                      >
                        {[
                          ["new", "待处理"],
                          ["read", "已查看"],
                          ["done", "已跟进"],
                        ].map(([v, n]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="metadata">
                      <span>{i.direction}</span>
                      <time>
                        {new Date(i.createdAt).toLocaleString("zh-CN")}
                      </time>
                    </div>
                    <p className="message-body">{i.message}</p>
                  </article>
                ))
              )}
            </>
          ) : (
            <>
              <div className="admin-heading">
                <div>
                  <p className="eyebrow">ACCOUNT</p>
                  <h1>账号安全</h1>
                </div>
              </div>
              <form
                className="account-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (f.get("password") !== f.get("confirm")) {
                    setError("两次新密码不一致。");
                    return;
                  }
                  action(async () => {
                    await request("/api/admin/password", {
                      method: "POST",
                      body: JSON.stringify({
                        current: f.get("current"),
                        password: f.get("password"),
                      }),
                    });
                    setLogged(false);
                    setData(null);
                    setMessage("密码已修改，请使用新密码登录。");
                  });
                }}
              >
                <label>
                  当前密码
                  <input
                    name="current"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label>
                  新密码（至少 12 个字符）
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={200}
                    required
                  />
                </label>
                <label>
                  确认新密码
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </label>
                <button className="button" disabled={busy}>
                  更改密码
                </button>
              </form>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
function Settings({ data, busy, onSave }) {
  const [s, setS] = useState(structuredClone(data.settings));
  return (
    <>
      <div className="admin-heading">
        <div>
          <p className="eyebrow">SITE SETTINGS</p>
          <h1>站点信息</h1>
          <p>调整首页文案、中心简介、研究方向和联系邮箱。</p>
        </div>
      </div>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(s);
        }}
      >
        {[
          ["heroTitle", "首页主标题", 2],
          ["heroSubtitle", "首页副标题", 1],
          ["aboutTitle", "中心主张", 2],
          ["aboutIntro", "中心简介摘要", 3],
          ["aboutBody", "完整简介", 6],
          ["contactEmail", "公开联系邮箱（可留空）", 1],
          ["footer", "页脚文案", 1],
        ].map(([k, n, r]) => (
          <Field
            key={k}
            label={n}
            textarea={r > 1}
            rows={r}
            value={s[k]}
            type={k === "contactEmail" ? "email" : "text"}
            onChange={(v) => setS({ ...s, [k]: v })}
          />
        ))}
        <h2>研究方向</h2>
        {s.directions.map((d, i) => (
          <div className="setting-direction" key={i}>
            <span className="number">0{i + 1}</span>
            <div>
              <Field
                label="方向名称"
                value={d.title}
                required
                maxLength={50}
                onChange={(v) =>
                  setS({
                    ...s,
                    directions: s.directions.map((x, j) =>
                      i === j ? { ...x, title: v } : x,
                    ),
                  })
                }
              />
              <Field
                label="简短说明"
                value={d.description}
                maxLength={150}
                onChange={(v) =>
                  setS({
                    ...s,
                    directions: s.directions.map((x, j) =>
                      i === j ? { ...x, description: v } : x,
                    ),
                  })
                }
              />
            </div>
          </div>
        ))}
        <button className="button" disabled={busy}>
          {busy ? "正在保存…" : "保存站点信息"}
        </button>
      </form>
    </>
  );
}
function Field({ label, value, onChange, textarea = false, ...props }) {
  const Tag = textarea ? "textarea" : "input";
  return (
    <label>
      {label}
      <Tag
        {...props}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function Uploader({ label, accept, url, onChange, onBusy }) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="upload-field">
      <span>{label}</span>
      {url &&
        (url.endsWith(".pdf") ? (
          <a href={url} target="_blank" rel="noreferrer">
            查看已上传 PDF
          </a>
        ) : (
          <img src={url} alt="封面预览" />
        ))}
      <label className="upload-button">
        <UploadSimple />
        {busy ? "正在上传…" : url ? "替换文件" : "选择文件"}
        <input
          type="file"
          accept={accept}
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setError("");
            if (file.size > 10 * 1024 * 1024) {
              setError("文件不能超过 10 MB。");
              return;
            }
            setBusy(true);
            onBusy(true);
            try {
              const form = new FormData();
              form.append("file", file);
              const r = await request("/api/admin/upload", {
                method: "POST",
                body: form,
              });
              if (
                (accept === "application/pdf" && r.type !== "pdf") ||
                (accept !== "application/pdf" && r.type === "pdf")
              )
                throw new Error("请选择符合类型的文件。");
              if (alive.current) onChange(r.url);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
              onBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {url && (
        <button type="button" onClick={() => onChange("")}>
          移除关联
        </button>
      )}
      <small>最大 10 MB</small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
