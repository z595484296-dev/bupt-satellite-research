import { Body, Attachments } from "./ArticleBody.jsx";
import { SatelliteHero } from "./SatelliteHero.jsx";
export { Body } from "./ArticleBody.jsx";
import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  entryPath,
  readingTarget,
  relatedEntries,
  contactPath,
  directionContactPath,
  contactContext,
  groupNews,
  newestEntries,
  filterEntries,
  archiveReturnPath,
} from "./content-navigation.js";
import {
  ArrowRight,
  ArrowLeft,
  List,
  X,
  MagnifyingGlass,
  Download,
  CheckCircle,
  ChartBar,
  Broadcast,
  ShieldCheck,
  Circle,
  ArrowUpRight,
} from "@phosphor-icons/react";
import {
  usePageMotion,
  useListMotion,
  useTabMotion,
  useReadingProgress,
  pop,
  nudge,
  settle,
  reduceMotion,
} from "./motion.js";
const Admin = lazy(() => import("./Admin.jsx"));
const hostedMirror = import.meta.env.VITE_SITES_MIRROR === "true";
export async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(data.error || "请求失败，请稍后重试。"), {
      status: res.status,
    });
  return data;
}
export function Link({ href, children, onClick, ...props }) {
  return (
    <a
      href={href}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          props.target ||
          props.download
        )
          return;
        if (
          href.startsWith("/") &&
          !href.startsWith("/media/") &&
          !href.startsWith("/api/")
        ) {
          e.preventDefault();
          history.pushState({}, "", href);
          dispatchEvent(new PopStateEvent("popstate"));
        }
      }}
    >
      {children}
    </a>
  );
}
const nav = [
  ["/", "首页"],
  ["/about", "关于中心"],
  ["/research", "研究与成果"],
  ["/insights", "观点洞察"],
  ["/news", "中心动态"],
  ["/contact", "合作交流"],
];
const href = entryPath;
const date = (d) => d?.replaceAll("-", ".");
function TextLink({ to, children, ...props }) {
  return (
    <Link className="text-link" href={to} {...props}>
      {children}
      <ArrowRight size={20} />
    </Link>
  );
}
function Label({ children }) {
  return <h2 className="section-label">{children}</h2>;
}
function ReadingLink({ entry, spaceUrl, children, ...props }) {
  const target = readingTarget(entry, spaceUrl);
  return (
    <Link
      href={target.href}
      {...props}
      {...(target.external
        ? { target: "_blank", rel: "noreferrer", title: "在新窗口打开" }
        : {})}
    >
      {children || (
        <>
          {target.label}
          {target.external ? (
            <ArrowUpRight size={18} />
          ) : (
            <ArrowRight size={18} />
          )}
        </>
      )}
    </Link>
  );
}
function Header({ path, settings }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef(null);
  const [scrolled, setScrolled] = useState(() => window.scrollY > 20);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 20);
    const escape = (event) => {
      if (event.key === "Escape" && document.querySelector("#main-nav.open")) {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    addEventListener("scroll", update, { passive: true });
    addEventListener("keydown", escape);
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <header
      className={`site-header ${scrolled ? "is-scrolled" : ""} ${open ? "menu-open" : ""}`}
    >
      <div className="header-inner">
        <Link href="/" className="wordmark">
          {settings.name}
          <span>{settings.affiliation}</span>
        </Link>
        <button
          className="menu-toggle"
          ref={menuButton}
          aria-label={open ? "关闭导航" : "打开导航"}
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={24} /> : <List size={24} />}
        </button>
        <nav id="main-nav" className={open ? "open" : ""} aria-label="主导航">
          {nav.slice(1).map(([url, title]) => (
            <Link
              key={url}
              href={url}
              className={url === "/contact" ? "nav-contact" : undefined}
              aria-current={path.startsWith(url) ? "page" : undefined}
            >
              {title}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
function Footer({ s }) {
  return (
    <footer>
      <div className="container footer-inner">
        <Link className="footer-brand" href="/">
          <strong>{s.name}</strong>
          <span>{s.affiliation}</span>
        </Link>
        <nav aria-label="页脚导航">
          {nav.slice(1).map(([url, title]) => (
            <Link key={url} href={url}>
              {title}
            </Link>
          ))}
        </nav>
        <div className="footer-bottom">
          <span>{s.footer}</span>
          {!hostedMirror && <Link href="/admin">内容管理</Link>}
        </div>
      </div>
    </footer>
  );
}
function DirectionExplorer({ s, entries, initialDirection, layout = "cards" }) {
  const vertical = layout === "editorial";
  const [selected, setSelected] = useState(() => {
    const index = s.directions.findIndex(
      (direction) => direction.title === initialDirection,
    );
    return index >= 0
      ? index
      : Math.min(1, Math.max(0, s.directions.length - 1));
  });
  const listRef = useRef(null),
    indicatorRef = useRef(null),
    panelRef = useRef(null),
    heightBefore = useRef(0);
  useTabMotion({ listRef, indicatorRef, panelRef, selected, heightBefore });
  const current = s.directions[selected] || s.directions[0];
  if (!current) return null;
  const related = relatedEntries(current, entries).slice(0, 2);
  function choose(index) {
    if (index === selected) return;
    heightBefore.current = panelRef.current?.offsetHeight || 0;
    setSelected(index);
  }
  function move(event, index) {
    const count = s.directions.length;
    const next =
      event.key === (vertical ? "ArrowDown" : "ArrowRight")
        ? (index + 1) % count
        : event.key === (vertical ? "ArrowUp" : "ArrowLeft")
          ? (index - 1 + count) % count
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? count - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
    event.currentTarget.parentElement
      .querySelectorAll('[role="tab"]')
      [next].focus();
  }
  return (
    <div
      className={`direction-explorer ${vertical ? "direction-editorial" : ""}`}
    >
      <div
        className="direction-tabs"
        role="tablist"
        aria-label="研究方向"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        ref={listRef}
      >
        <span className="tab-indicator" ref={indicatorRef} aria-hidden="true" />
        {s.directions.map((direction, index) => (
          <button
            key={index}
            role="tab"
            id={`direction-tab-${index}`}
            aria-controls="direction-panel"
            aria-selected={selected === index}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => choose(index)}
            onKeyDown={(event) => move(event, index)}
          >
            {direction.title}
            {vertical && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div
        className="direction-results"
        id="direction-panel"
        role="tabpanel"
        aria-labelledby={`direction-tab-${selected}`}
        tabIndex={0}
        ref={panelRef}
      >
        <div className="direction-panel">
          <h3>{current.description}</h3>
          <TextLink
            to={directionContactPath(current, vertical ? "about" : "home")}
          >
            探讨这一方向
          </TextLink>
        </div>
        {related.length > 0 ? (
          <div
            key={current.title}
            className={`direction-cards ${related.length === 1 ? "single" : ""}`}
          >
            {related.map((entry) => (
              <article
                key={entry.id}
                className={`direction-card ${entry.kind === "research" ? "research-card" : "opinion-card"} ${entry.cover ? "has-cover" : ""}`}
              >
                {!vertical && (entry.cover || entry.kind === "research") && (
                  <img
                    className="direction-art"
                    src={entry.cover || "/assets/apple-research-day.webp"}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div className="direction-card-copy cg">
                  <p className="result-kind cg-meta">
                    {entry.kind === "research"
                      ? entry.format || "研究介绍"
                      : "相关观点"}
                  </p>
                  <h4 className="cg-title">
                    <ReadingLink entry={entry} spaceUrl={s.sourceUrl}>
                      {entry.title}
                    </ReadingLink>
                  </h4>
                  {(entry.subtitle || entry.summary) && (
                    <p className="cg-sum">{entry.subtitle || entry.summary}</p>
                  )}
                  <ReadingLink
                    className="text-link cg-link"
                    entry={entry}
                    spaceUrl={s.sourceUrl}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="direction-empty">
            <p>这一方向的公开研究内容将陆续更新。</p>
            <span>欢迎带着具体问题，与我们展开交流。</span>
            <TextLink to="/research">浏览全部研究</TextLink>
          </div>
        )}
      </div>
    </div>
  );
}
function CollaborationCTA({ title = "下一步，一起探索。" }) {
  return (
    <section className="collaboration-cta container" data-reveal-group>
      <h2 data-reveal="title">{title}</h2>
      <p data-reveal="fade">联合研究、产业交流、学术研讨。</p>
      <Link className="button" href="/contact" data-reveal="fade">
        合作交流
        <ArrowRight size={18} />
      </Link>
    </section>
  );
}
/* 首屏标题按字拆分，供开场逐字浮现；读屏仍读取完整标题 */
function HeroTitle({ text }) {
  return (
    <h1 aria-label={text.replace(/\n/g, "")}>
      {text.split("\n").map((line, i) => (
        <span className="hero-line" key={i} aria-hidden="true">
          {[...line].map((char, j) => (
            <span className="hero-char" key={j}>
              {char}
            </span>
          ))}
        </span>
      ))}
    </h1>
  );
}
/* 标题语义断行：中文标点后断句，“卫星互联网”保持完整 */
function SemanticTitle({ text }) {
  return text.split(/(?<=[，；：？])/u).map((clause, index) => (
    <span className="insight-title-clause" key={index}>
      {clause.split(/(卫星互联网)/u).map((part, partIndex) =>
        part === "卫星互联网" ? (
          <span className="insight-title-term" key={partIndex}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  ));
}
function Home({ s, entries, search }) {
  const insights = entries
    .filter((entry) => entry.kind === "insight")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 2);
  const news = newestEntries(entries, "news").slice(0, 3);
  return (
    <div className="home-satellite">
      <section className="apple-hero" data-intro>
        <div className="hero-copy container">
          <HeroTitle text={s.heroTitle} />
          <p data-intro-item>{s.heroSubtitle}</p>
          <div className="actions">
            <Link className="button" href="/research" data-intro-item>
              探索研究
              <ArrowRight size={18} />
            </Link>
            <Link className="button secondary" href="/about" data-intro-item>
              认识中心
            </Link>
          </div>
        </div>
        <SatelliteHero />
      </section>
      <section className="home-intro container" data-reveal-group>
        <div>
          <h2 data-reveal="title">{s.aboutTitle}</h2>
          <Link className="button secondary" href="/about" data-reveal="fade">
            了解中心
            <ArrowRight size={18} />
          </Link>
        </div>
        <p data-reveal="fade" data-rule="y">
          {s.aboutIntro}
        </p>
      </section>
      <section className="home-research" id="research-directions">
        <div className="container">
          <h2 data-reveal="title">从关键问题出发。</h2>
          <div data-reveal="fade">
            <DirectionExplorer
              s={s}
              entries={entries}
              initialDirection={new URLSearchParams(search).get("direction")}
            />
          </div>
        </div>
      </section>
      {insights.length > 0 && (
        <section className="container home-editorial">
          <div className="section-heading" data-reveal-group>
            <h2 data-reveal="title">新的思考，持续发生。</h2>
            <TextLink to="/insights" data-reveal="fade">
              全部观点
            </TextLink>
          </div>
          <div className="insight-pair">
            {insights.map((entry, index) => (
              <article
                key={entry.id}
                className="cg"
                data-reveal="fade"
                data-rule={index ? "y" : undefined}
              >
                <div className="metadata cg-meta">
                  {entry.category && (
                    <span className="tag">{entry.category}</span>
                  )}
                  {entry.date && (
                    <time dateTime={entry.date}>{date(entry.date)}</time>
                  )}
                </div>
                <h3 className="cg-title">
                  <ReadingLink entry={entry} spaceUrl={s.sourceUrl}>
                    <SemanticTitle text={entry.title} />
                  </ReadingLink>
                </h3>
                {entry.summary && <p className="cg-sum">{entry.summary}</p>}
                <ReadingLink
                  className="text-link cg-link"
                  entry={entry}
                  spaceUrl={s.sourceUrl}
                />
              </article>
            ))}
          </div>
        </section>
      )}
      {news.length > 0 && (
        <section className="container home-news">
          <div className="section-heading" data-reveal-group>
            <h2 data-reveal="title">中心动态</h2>
            <TextLink to="/news" data-reveal="fade">
              全部动态
            </TextLink>
          </div>
          <div className="home-news-list">
            {news.map((entry) => (
              <Link
                key={entry.id}
                className="news-row"
                href={href(entry)}
                data-reveal="fade"
              >
                <span className="news-kind">
                  {entry.category || "中心动态"}
                </span>
                <time dateTime={entry.date}>{date(entry.date)}</time>
                <h3>{entry.title}</h3>
                <ArrowRight size={20} />
              </Link>
            ))}
          </div>
        </section>
      )}
      <CollaborationCTA />
    </div>
  );
}
function About({ s, entries, search }) {
  const founding = entries.find((entry) => entry.id === "center-established");
  const latest = entries
    .filter((entry) => entry.kind === "news" && entry.id !== founding?.id)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 3);
  return (
    <div className="about-rich">
      <section className="about-masthead" aria-labelledby="about-title">
        <div className="container about-masthead-inner">
          <p className="page-kicker" data-reveal="fade">
            关于中心
          </p>
          <h1 id="about-title" data-reveal="title">
            {s.aboutTitle}
          </h1>
          <p className="about-lead" data-reveal="fade">
            {s.aboutIntro}
          </p>
          <div className="actions" data-reveal="fade">
            <a className="button" href="#center-story">
              认识中心
            </a>
            <a className="button secondary" href="#about-research">
              研究方向 <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <section
        className="about-foundation container"
        data-reveal-group
        id="center-story"
        aria-labelledby="center-story-title"
      >
        <div className="about-origin" data-reveal="fade">
          <h2 id="center-story-title">中心简介</h2>
          {founding?.date && (
            <div className="about-founded">
              <time dateTime={founding.date}>{date(founding.date)}</time>
              <span>研究中心成立</span>
            </div>
          )}
        </div>
        <div className="about-story" data-reveal="fade" data-rule="y">
          <p className="about-institution">
            {s.affiliation}
            <span>{s.name}</span>
          </p>
          {(s.aboutBody || s.aboutIntro)
            .split(/\n\s*\n/)
            .map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
        </div>
      </section>

      <section
        className="about-foundations container"
        aria-labelledby="about-disciplines-title"
      >
        <h2 id="about-disciplines-title" data-reveal="fade">
          研究的学科基础
        </h2>
        <div className="about-discipline-list">
          {[
            [Broadcast, "信息通信工程"],
            [ShieldCheck, "网络空间安全"],
            [ChartBar, "产业经济管理"],
          ].map(([Icon, title]) => (
            <div className="about-discipline" key={title} data-reveal="fade">
              <Icon size={29} weight="light" aria-hidden="true" />
              <h3>{title}</h3>
            </div>
          ))}
        </div>
      </section>

      <section
        className="about-research"
        id="about-research"
        aria-labelledby="about-research-title"
      >
        <div className="container">
          <div className="about-section-heading" data-reveal-group>
            <h2 id="about-research-title" data-reveal="title">
              我们关注的问题。
            </h2>
            <TextLink to="/research" data-reveal="fade">
              全部研究与成果
            </TextLink>
          </div>
          <div data-reveal="fade">
            <DirectionExplorer
              s={s}
              entries={entries}
              layout="editorial"
              initialDirection={new URLSearchParams(search).get("direction")}
            />
          </div>
        </div>
      </section>

      {latest.length > 0 && (
        <section
          className="about-practice container"
          aria-labelledby="about-practice-title"
        >
          <div className="about-section-heading" data-reveal-group>
            <div>
              <h2 id="about-practice-title" data-reveal="title">
                交流与实践。
              </h2>
              <p data-reveal="fade">走进产业现场，围绕真实问题展开交流。</p>
            </div>
            <TextLink to="/news" data-reveal="fade">
              全部中心动态
            </TextLink>
          </div>
          <ol className="about-journal">
            {latest.map((entry) => (
              <li key={entry.id} data-reveal="fade">
                <Link href={href(entry)} className="about-journal-link">
                  <time dateTime={entry.date}>
                    {date(entry.date) || "最新动态"}
                  </time>
                  <span className="about-journal-content cg">
                    {entry.category && (
                      <span className="about-journal-category cg-meta">
                        {entry.category}
                      </span>
                    )}
                    <h3 className="cg-title">{entry.title}</h3>
                    {entry.summary && <p className="cg-sum">{entry.summary}</p>}
                  </span>
                  <ArrowUpRight size={22} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section
        className="about-connect"
        aria-labelledby="about-connect-title"
        data-reveal-group
      >
        <div className="container">
          <div>
            <h2 id="about-connect-title" data-reveal="title">
              让研究与实践，
              <br />
              在这里相遇。
            </h2>
            <p data-reveal="fade">联合研究、产业交流、学术研讨。</p>
          </div>
          <Link className="button" href="/contact" data-reveal="fade">
            与中心交流 <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function PageTitle({ en, label, title, description }) {
  return (
    <div className="page-title">
      <p className="page-kicker" data-reveal="fade">
        {label || en}
      </p>
      <h1 data-reveal="title">{title}</h1>
      {description && <p data-reveal="fade">{description}</p>}
    </div>
  );
}
function Library({ kind, entries, s }) {
  const { filters, update, reset, returnQuery } = useArchiveFilters();
  const category = filters.category || "全部",
    query = filters.query;
  const setCategory = (value) =>
    update("category", value === "全部" ? "" : value);
  const setQuery = (value) => update("query", value);
  const items = newestEntries(entries, kind);
  const cats = [
    "全部",
    ...new Set(items.map((e) => e.category).filter(Boolean)),
  ];
  const filtered = filterEntries(items, filters);
  const research = kind === "research";
  const listRef = useRef(null);
  useListMotion(listRef, filtered.map((e) => e.id).join("|"));
  return (
    <div
      className={`container library ${research ? "research-library" : "insights-library"}`}
    >
      <PageTitle
        en={research ? "RESEARCH & PUBLICATIONS" : "INSIGHTS"}
        label={research ? "研究与成果" : "观点洞察"}
        title={research ? "从关键问题出发。" : "新的思考，持续发生。"}
        description={
          research ? "从商业模式到产业生态" : "理解产业变化，分享研究思考"
        }
      />
      <div className="library-tools" data-reveal="fade">
        <div className="tabs" role="group" aria-label="内容分类">
          {cats.map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="search">
          <MagnifyingGlass size={19} />
          <input
            aria-label="搜索内容"
            placeholder="搜索内容"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="清除搜索" onClick={() => setQuery("")}>
              <X />
            </button>
          )}
        </label>
      </div>
      <p className="archive-count" role="status">
        {filtered.length === items.length
          ? `共 ${items.length} 篇`
          : `找到 ${filtered.length} 篇，共 ${items.length} 篇`}
      </p>
      <div
        className={research ? "research-list" : "article-list"}
        ref={listRef}
      >
        {filtered.map((e, i) => (
          <article
            key={e.id}
            data-key={e.id}
            data-reveal="fade"
            className={
              (e.featured && i === 0 ? "featured " : "") +
              (e.cover ? "with-cover" : "")
            }
          >
            {research && e.featured && i === 0 && !e.cover && (
              <img
                className="library-art"
                src="/assets/apple-research-day.webp"
                alt=""
                loading="lazy"
              />
            )}
            <ReadingLink
              entry={e}
              spaceUrl={s.sourceUrl}
              className="entry-link"
              {...(!readingTarget(e, s.sourceUrl).external
                ? { href: href(e) + returnQuery }
                : {})}
            >
              {e.cover && <img src={e.cover} alt="" loading="lazy" />}
              <div className="cg">
                <div className="metadata cg-meta">
                  {e.category && <span className="tag">{e.category}</span>}
                  {(e.format || e.channel) && (
                    <span>{e.format || e.channel}</span>
                  )}
                  {e.date && <time>{date(e.date)}</time>}
                </div>
                <h2 className="cg-title">
                  <SemanticTitle text={e.title} />
                </h2>
                {(e.subtitle || e.summary) && (
                  <p className="cg-sum">{e.subtitle || e.summary}</p>
                )}
                {research && e.subtitle && e.summary && (
                  <p className="entry-summary cg-sum2">{e.summary}</p>
                )}
                <span className="text-link cg-link">
                  {readingTarget(e, s.sourceUrl).label}
                  {readingTarget(e, s.sourceUrl).external ? (
                    <ArrowUpRight size={20} />
                  ) : (
                    <ArrowRight size={20} />
                  )}
                </span>
              </div>
              {readingTarget(e, s.sourceUrl).external ? (
                <ArrowUpRight className="entry-arrow" size={28} />
              ) : (
                <ArrowRight className="entry-arrow" size={28} />
              )}
            </ReadingLink>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty">
          <h2>{items.length ? "暂未找到相关内容" : "暂无已发布内容"}</h2>
          <p>
            {items.length
              ? "试试其他关键词或分类。"
              : "新的研究内容将在这里更新。"}
          </p>
          {items.length > 0 && (
            <button
              className="button"
              onClick={() => {
                reset();
              }}
            >
              显示全部内容
            </button>
          )}
        </div>
      )}
      {research && <CollaborationCTA title="围绕共同问题，开展深入交流。" />}
    </div>
  );
}
function useArchiveFilters() {
  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams(location.search);
    return {
      query: params.get("q") || "",
      category: params.get("category") || "",
      year: params.get("year") || "",
    };
  });
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.category) params.set("category", filters.category);
  if (filters.year) params.set("year", filters.year);
  const queryString = params.toString();
  useEffect(() => {
    history.replaceState(
      history.state,
      "",
      location.pathname + (queryString ? `?${queryString}` : ""),
    );
  }, [queryString]);
  return {
    filters,
    update: (name, value) => setFilters((old) => ({ ...old, [name]: value })),
    reset: () => setFilters({ query: "", category: "", year: "" }),
    returnQuery: queryString
      ? `?return=${encodeURIComponent(location.pathname + "?" + queryString)}`
      : "",
  };
}
function News({ entries }) {
  const { filters, update, reset, returnQuery } = useArchiveFilters();
  const [limit, setLimit] = useState(12);
  const items = newestEntries(entries, "news");
  const filtered = filterEntries(items, filters);
  const groups = groupNews(filtered.slice(0, limit));
  useEffect(() => setLimit(12), [filters]);
  const listRef = useRef(null);
  useListMotion(
    listRef,
    filtered
      .slice(0, limit)
      .map((e) => e.id)
      .join("|"),
  );
  return (
    <div className="container news-page">
      <PageTitle
        en="NEWS & ACTIVITIES"
        label="中心动态"
        title="记录每一步探索。"
        description="记录研究进展与交流实践"
      />
      <div className="archive-tools" data-reveal="fade">
        <label className="search">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <input
            aria-label="搜索中心动态"
            placeholder="搜索活动、机构或关键词"
            value={filters.query}
            onChange={(e) => update("query", e.target.value)}
          />
          {filters.query && (
            <button aria-label="清除搜索" onClick={() => update("query", "")}>
              <X size={18} />
            </button>
          )}
        </label>
        <label className="archive-select">
          <span>活动类型</span>
          <select
            value={filters.category}
            aria-label="活动类型"
            onChange={(e) => update("category", e.target.value)}
          >
            <option value="">全部类型</option>
            {[...new Set(items.map((e) => e.category).filter(Boolean))].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label className="archive-select">
          <span>年份</span>
          <select
            value={filters.year}
            aria-label="年份"
            onChange={(e) => update("year", e.target.value)}
          >
            <option value="">全部年份</option>
            {[
              ...new Set(items.map((e) => e.date?.slice(0, 4)).filter(Boolean)),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="archive-summary">
        <p className="archive-count" role="status">
          {filtered.length === items.length
            ? `共 ${items.length} 条动态`
            : `找到 ${filtered.length} 条，共 ${items.length} 条动态`}
        </p>
        {Object.values(filters).some(Boolean) && (
          <button className="reset-filters" onClick={reset}>
            重置筛选
          </button>
        )}
      </div>
      <div className="timeline" ref={listRef}>
        {groups.map(([year, items]) => (
          <section
            className="news-year"
            key={year}
            aria-label={`${year}年动态`}
          >
            <h2 className="year-label" data-reveal="fade">
              {year}
            </h2>
            <div>
              {items.map((e) => (
                <Link
                  href={href(e) + returnQuery}
                  className="news-row"
                  key={e.id}
                  data-key={e.id}
                  data-reveal="fade"
                >
                  <time dateTime={e.date || undefined}>
                    {e.date?.slice(5)
                      ? `${Number(e.date.slice(5, 7))}月${e.date.length === 10 ? `${Number(e.date.slice(8))}日` : ""}`
                      : ""}
                  </time>
                  <div className="cg">
                    {e.category && (
                      <span className="tag cg-meta">{e.category}</span>
                    )}
                    <h3 className="cg-title">{e.title}</h3>
                    <p className="cg-sum">{e.summary}</p>
                  </div>
                  <ArrowRight size={26} />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      {filtered.length > limit && (
        <div className="archive-more">
          <button
            className="button secondary"
            onClick={() => setLimit((n) => n + 12)}
          >
            加载更多动态 <span>还有 {filtered.length - limit} 条</span>
          </button>
        </div>
      )}
      {!groups.length && (
        <div className="empty">
          <h2>{items.length ? "暂未找到相关动态" : "暂无已发布动态"}</h2>
          <p>
            {items.length
              ? "试试其他关键词，或调整活动类型与年份。"
              : "中心的研究进展与交流活动将在这里更新。"}
          </p>
          {items.length > 0 && (
            <button className="button" onClick={reset}>
              显示全部动态
            </button>
          )}
        </div>
      )}
      <div className="quiet-cta">
        <span>了解中心的研究方向与学科基础</span>
        <TextLink to="/about">关于中心</TextLink>
      </div>
    </div>
  );
}
function ReadingProgress({ articleRef }) {
  const barRef = useRef(null);
  useReadingProgress(barRef, articleRef);
  return (
    <div className="reading-progress" aria-hidden="true" data-visible="false">
      <span ref={barRef} />
    </div>
  );
}
function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const update = () => setShow(scrollY > innerHeight * 1.2);
    update();
    addEventListener("scroll", update, { passive: true });
    return () => removeEventListener("scroll", update);
  }, []);
  return (
    <button
      type="button"
      className="back-to-top"
      data-show={show}
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      aria-label="返回顶部"
      onClick={() => {
        scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
        document.getElementById("main")?.focus({ preventScroll: true });
      }}
    >
      <ArrowRight size={20} aria-hidden="true" />
    </button>
  );
}
function Detail({ entry, entries, s }) {
  const articleRef = useRef(null);
  if (!entry)
    return (
      <div className="container empty">
        <h1>内容暂未发布或不存在</h1>
        <TextLink to="/">返回首页</TextLink>
      </div>
    );
  const e = entry;
  const research = e.kind === "research";
  const direction = s.directions.find(
    (item) => relatedEntries(item, [e]).length,
  );
  const related = direction
    ? relatedEntries(direction, entries)
        .filter((item) => item.id !== e.id)
        .slice(0, 2)
    : [];
  const sourceIsSpace =
    e.sourceUrl &&
    readingTarget({ ...e, kind: "insight", body: "" }, s.sourceUrl).isSpace;
  return (
    <article
      className={`container detail ${research ? "research-detail" : ""}`}
      ref={articleRef}
    >
      <ReadingProgress articleRef={articleRef} />
      <BackToTop />
      <Link
        data-reveal="fade"
        className="back-link"
        href={archiveReturnPath(location.search, e.kind)}
      >
        <ArrowLeft />
        返回
        {e.kind === "research"
          ? "研究与成果"
          : e.kind === "news"
            ? "中心动态"
            : "观点洞察"}
      </Link>
      <div className="metadata" data-reveal="fade">
        {e.category && <span className="tag">{e.category}</span>}
        {(e.format || e.channel) && <span>{e.format || e.channel}</span>}
        {e.date && <time dateTime={e.date}>{date(e.date)}</time>}
        {e.author && <span>{e.author}</span>}
      </div>
      <h1 data-reveal="title">
        <SemanticTitle text={e.title} />
      </h1>
      {e.subtitle && (
        <p className="lead" data-reveal="fade">
          {e.subtitle}
        </p>
      )}
      {e.cover && <img className="detail-cover" src={e.cover} alt={e.title} />}
      <div
        className={research ? "research-detail-grid" : undefined}
        data-reveal="fade"
      >
        <div>
          {e.summary && !research && (
            <p className="detail-summary">{e.summary}</p>
          )}
          <Body text={e.body} />
          <Attachments items={e.attachments} />
          {!e.body && (
            <p className="source-note">
              {e.sourceUrl
                ? sourceIsSpace
                  ? "相关内容收录于中心公开空间，可前往查找。"
                  : "这篇内容已公开发布，可直接打开原文阅读。"
                : e.attachment
                  ? "详细内容请下载下方 PDF 阅读。"
                  : "详细内容待补充，欢迎围绕这一主题与中心交流。"}
            </p>
          )}
          <div className="detail-actions">
            {e.attachment && (
              <a className="button" href={e.attachment} download>
                <Download />
                下载 PDF
              </a>
            )}
            {e.sourceUrl && !e.body && (
              <a
                className="text-link"
                href={e.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {sourceIsSpace ? "前往公开空间" : "阅读原文"}
                <ArrowUpRight />
              </a>
            )}
          </div>
        </div>
        {research && (
          <aside className="research-aside">
            <h2>研究信息</h2>
            <dl>
              {e.format && (
                <>
                  <dt>内容类型</dt>
                  <dd>{e.format}</dd>
                </>
              )}
              {e.category && (
                <>
                  <dt>研究方向</dt>
                  <dd>{e.category}</dd>
                </>
              )}
              {e.author && (
                <>
                  <dt>作者</dt>
                  <dd>{e.author}</dd>
                </>
              )}
              {e.date && (
                <>
                  <dt>发布日期</dt>
                  <dd>{date(e.date)}</dd>
                </>
              )}
            </dl>
            <Link className="button" href={contactPath(e)}>
              交流这一研究
              <ArrowRight size={18} />
            </Link>
          </aside>
        )}
      </div>
      {related.length > 0 && (
        <section className="related-reading" data-reveal="fade">
          <h2>延伸阅读</h2>
          {related.map((item) => (
            <ReadingLink
              className="related-row"
              key={item.id}
              entry={item}
              spaceUrl={s.sourceUrl}
            >
              <div>
                <span>
                  {item.kind === "research" ? "相关研究" : "相关观点"}
                </span>
                <h3>{item.title}</h3>
              </div>
              {readingTarget(item, s.sourceUrl).external ? (
                <ArrowUpRight size={22} />
              ) : (
                <ArrowRight size={22} />
              )}
            </ReadingLink>
          ))}
        </section>
      )}
      {!research && (
        <div className="quiet-cta">
          <span>围绕这一主题开展交流</span>
          <TextLink to={contactPath(e)}>联系中心</TextLink>
        </div>
      )}
    </article>
  );
}
function Contact({ s, entries, search }) {
  const context = contactContext(search, entries, s.directions);
  const [values, setValues] = useState({
      name: "",
      organization: "",
      email: "",
      direction: context?.type || "联合研究",
      message: context ? `我希望围绕「${context.title}」开展交流。\n\n` : "",
      website: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [id, setId] = useState("");
  const choicesRef = useRef(null),
    errorRef = useRef(null),
    successRef = useRef(null),
    firstChoice = useRef(true);
  useEffect(() => {
    if (firstChoice.current) {
      firstChoice.current = false;
      return;
    }
    pop(choicesRef.current?.querySelector('[aria-pressed="true"] .choice-status svg'));
  }, [values.direction]);
  useEffect(() => {
    if (error) nudge(errorRef.current);
  }, [error]);
  useEffect(() => {
    if (id) settle(successRef.current?.children);
  }, [id]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await request("/api/inquiries", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setId(r.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="contact-page">
      <div className="container">
        <PageTitle
          en="COLLABORATION"
          label="合作交流"
          title="下一步，一起探索。"
          description="联合研究、产业交流、学术研讨。"
        />
        <div className="contact-grid">
          <div className="contact-intro">
            <h2 data-reveal="title">找到共同的问题。</h2>
            <div
              className="cooperation-types"
              ref={choicesRef}
              data-reveal="fade"
            >
              {[
                ["联合研究", "共同探索产业发展中的关键问题。"],
                ["产业交流", "连接产业观察与商业实践。"],
                ["学术研讨", "分享研究观点，拓展学术对话。"],
              ].map(([a, b]) => (
                <button
                  key={a}
                  type="button"
                  className="cooperation-choice"
                  aria-pressed={values.direction === a}
                  onClick={() => setValues({ ...values, direction: a })}
                  disabled={busy || Boolean(id)}
                >
                  <span className="choice-status">
                    {values.direction === a ? (
                      <CheckCircle size={26} weight="fill" />
                    ) : (
                      <Circle size={26} />
                    )}
                  </span>
                  <span>
                    <strong>{a}</strong>
                    <span className="choice-description">{b}</span>
                  </span>
                </button>
              ))}
            </div>
            {s.contactEmail && (
              <a className="text-link" href={`mailto:${s.contactEmail}`}>
                {s.contactEmail}
                <ArrowRight />
              </a>
            )}
          </div>
          <div className="contact-form" data-reveal="fade">
            {id ? (
              <div className="success" role="status" ref={successRef}>
                <CheckCircle size={46} />
                <h2>合作意向已收到</h2>
                <p>我们会根据你留下的邮箱与你联系。</p>
                <p className="muted">
                  提交编号：{id.slice(0, 8).toUpperCase()}
                </p>
                <TextLink to="/research">了解中心研究</TextLink>
              </div>
            ) : (
              <form onSubmit={submit}>
                <fieldset disabled={busy}>
                  <h2>留下合作意向</h2>
                  <p>请简要介绍你的合作需求。* 为必填项</p>
                  {context && (
                    <div className="contact-context">
                      <span>本次交流主题</span>
                      <strong>{context.title}</strong>
                      <Link href={context.back}>
                        返回主题
                        <ArrowUpRight size={16} />
                      </Link>
                    </div>
                  )}
                  <div className="field-pair">
                    <label>
                      姓名 <span>*</span>
                      <input
                        name="name"
                        autoComplete="name"
                        required
                        maxLength={60}
                        value={values.name}
                        onChange={(e) =>
                          setValues({ ...values, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      单位 / 组织
                      <input
                        name="organization"
                        autoComplete="organization"
                        maxLength={160}
                        value={values.organization}
                        onChange={(e) =>
                          setValues({ ...values, organization: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    联系邮箱 <span>*</span>
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      value={values.email}
                      onChange={(e) =>
                        setValues({ ...values, email: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    合作方向 <span>*</span>
                    <select
                      name="direction"
                      value={values.direction}
                      onChange={(e) =>
                        setValues({ ...values, direction: e.target.value })
                      }
                    >
                      {["联合研究", "产业交流", "学术研讨", "其他合作"].map(
                        (x) => (
                          <option key={x}>{x}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    合作需求 <span>*</span>
                    <textarea
                      name="message"
                      required
                      rows={4}
                      maxLength={2000}
                      placeholder="简单介绍你希望探讨的问题或合作想法"
                      value={values.message}
                      onChange={(e) =>
                        setValues({ ...values, message: e.target.value })
                      }
                    />
                  </label>
                  <label className="honeypot" aria-hidden="true">
                    Website
                    <input
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      value={values.website}
                      onChange={(e) =>
                        setValues({ ...values, website: e.target.value })
                      }
                    />
                  </label>
                  {error && (
                    <p className="error" role="alert" ref={errorRef}>
                      {error}
                    </p>
                  )}
                  <button
                    className={`button submit-button ${busy ? "is-busy" : ""}`}
                    disabled={busy}
                  >
                    {busy ? "正在提交…" : "提交合作意向"}
                    {busy ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : (
                      <ArrowRight />
                    )}
                  </button>
                  <p className="privacy-note">
                    你提供的信息仅用于本次合作沟通。
                  </p>
                </fieldset>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
export function App() {
  const [path, setPath] = useState(location.pathname),
    [search, setSearch] = useState(location.search),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  const mainRef = useRef(null);
  usePageMotion(
    mainRef,
    path + search,
    Boolean(data) && !path.startsWith("/admin"),
  );
  const refresh = () =>
    request("/api/content")
      .then((next) => {
        setData((old) => (old?.version === next.version ? old : next));
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
    const f = () => {
      setPath(location.pathname);
      setSearch(location.search);
      if (location.hash)
        requestAnimationFrame(() =>
          document.getElementById(location.hash.slice(1))?.scrollIntoView(),
        );
      else scrollTo({ top: 0, behavior: "instant" });
    };
    addEventListener("popstate", f);
    const visibleRefresh = () => {
      if (
        document.visibilityState === "visible" &&
        !location.pathname.startsWith("/admin")
      )
        refresh();
    };
    const timer = setInterval(visibleRefresh, 60000);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      removeEventListener("popstate", f);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, []);
  useEffect(() => {
    if (!data || path.startsWith("/admin")) return;
    const frame = requestAnimationFrame(() => {
      if (location.hash)
        document.getElementById(location.hash.slice(1))?.scrollIntoView();
      else document.getElementById("main")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [path, search, Boolean(data)]);
  useEffect(() => {
    document.title =
      (data?.entries.find((e) => href(e) === path)?.title ||
        nav.find(([p]) => p !== "/" && path.startsWith(p))?.[1] ||
        data?.settings.name ||
        "卫星互联网研究中心") +
      " · " +
      (data?.settings.affiliation || "北京邮电大学");
    const entry = data?.entries.find((e) => href(e) === path);
    const description = entry?.summary || entry?.title || data?.settings.intro;
    if (description)
      document
        .querySelector('meta[name="description"]')
        ?.setAttribute("content", description);
  }, [path, data]);
  if (path.startsWith("/admin"))
    if (hostedMirror)
      return (
        <div className="container empty">
          <h1>内容在本地统一管理</h1>
          <p>在 FlowUs 更新内容后，网站会自动同步。</p>
          <TextLink to="/">返回网站</TextLink>
        </div>
      );
  if (path.startsWith("/admin"))
    return (
      <Suspense fallback={<div className="empty">正在加载管理后台…</div>}>
        <Admin onUpdate={refresh} />
      </Suspense>
    );
  if (!data)
    return (
      <div className="empty" role="status">
        {error || "正在加载研究中心…"}
        {error && <button onClick={refresh}>重试</button>}
      </div>
    );
  const s = data.settings,
    entries = data.entries;
  let page =
    path === "/" ? (
      <Home key={search} s={s} entries={entries} search={search} />
    ) : path === "/about" ? (
      <About key={search} s={s} entries={entries} search={search} />
    ) : path === "/research" ? (
      <Library key="research" kind="research" entries={entries} s={s} />
    ) : path === "/insights" ? (
      <Library key="insight" kind="insight" entries={entries} s={s} />
    ) : path === "/news" ? (
      <News entries={entries} />
    ) : path === "/contact" ? (
      <Contact key={search} s={s} entries={entries} search={search} />
    ) : (
      <Detail
        entry={entries.find((e) => href(e) === path)}
        entries={entries}
        s={s}
      />
    );
  return (
    <>
      <a className="skip-link" href="#main">
        跳至正文
      </a>
      <Header path={path + search} settings={s} />
      <main id="main" tabIndex={-1} ref={mainRef}>
        {page}
      </main>
      <Footer s={s} />
    </>
  );
}
