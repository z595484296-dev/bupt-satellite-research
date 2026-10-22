export const entryPath = (entry) =>
  `/${entry.kind === "insight" ? "insights" : entry.kind}/${entry.id}`;

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    // Query strings on share-home URLs do not turn them into article links.
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function readingTarget(entry, spaceUrl = "") {
  if (
    entry.kind === "insight" &&
    !entry.body?.trim() &&
    !entry.attachments?.length
  ) {
    const source = normalizedUrl(entry.sourceUrl);
    if (source) {
      const isSpace = source === normalizedUrl(spaceUrl);
      return {
        href: entry.sourceUrl,
        external: true,
        label: isSpace ? "前往公开空间" : "阅读原文",
        isSpace,
      };
    }
    if (entry.attachment) {
      return { href: entry.attachment, external: true, label: "阅读 PDF" };
    }
  }
  return {
    href: entryPath(entry),
    external: false,
    label: entry.kind === "research" ? "查看研究介绍" : "阅读全文",
  };
}

const directionAliases = {
  运营商战略: ["运营商", "运营战略"],
  商业模式与平台生态: ["商业模式", "平台生态", "商业化"],
  产业政策: ["产业政策", "政策分析", "政策研究"],
  应用与产业案例: ["应用", "产业案例", "案例研究"],
};
export function relatedEntries(direction, entries) {
  const terms =
    directionAliases[direction.title] ||
    direction.title.split(/[与和、及]/).filter((term) => term.length >= 2);
  return entries
    .filter(
      (entry) =>
        entry.kind !== "news" &&
        entry.status !== "draft" &&
        terms.some((term) =>
          [entry.title, entry.category, entry.subtitle, entry.summary]
            .join(" ")
            .includes(term),
        ),
    )
    .sort(
      (a, b) =>
        Number(b.kind === "research") - Number(a.kind === "research") ||
        Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
        (b.date || "").localeCompare(a.date || ""),
    );
}

export const contactPath = (entry) =>
  `/contact?topic=${encodeURIComponent(entry.id)}`;
export const directionContactPath = (direction, origin = "home") =>
  `/contact?direction=${encodeURIComponent(direction.title)}${origin === "about" ? "&from=about" : ""}`;

export function contactContext(search, entries, directions) {
  const params = new URLSearchParams(search);
  const entry = entries.find(
    (item) => item.id === params.get("topic") && item.status !== "draft",
  );
  const direction = directions.find(
    (item) => item.title === params.get("direction"),
  );
  if (entry)
    return {
      title: entry.title,
      back: entryPath(entry),
      type: entry.kind === "insight" ? "学术研讨" : "联合研究",
    };
  if (direction)
    return {
      title: direction.title,
      back: `${params.get("from") === "about" ? "/about" : "/"}?direction=${encodeURIComponent(direction.title)}#${params.get("from") === "about" ? "about-research" : "research-directions"}`,
      type: "联合研究",
    };
  return null;
}

export function groupNews(entries) {
  const groups = new Map();
  const items = entries
    .filter((entry) => entry.kind === "news" && entry.status !== "draft")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  for (const entry of items) {
    const year = /^\d{4}/.test(entry.date || "")
      ? entry.date.slice(0, 4)
      : "未注明日期";
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(entry);
  }
  return [...groups];
}

export function newestEntries(entries, kind) {
  return entries
    .filter((e) => e.kind === kind && e.status !== "draft")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

export function filterEntries(
  entries,
  { query = "", category = "", year = "" } = {},
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(
    (e) =>
      (!category || e.category === category) &&
      (!year || e.date?.slice(0, 4) === year) &&
      terms.every((term) =>
        [
          e.title,
          e.subtitle,
          e.summary,
          e.category,
          e.author,
          e.channel,
          e.body,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(term),
      ),
  );
}

export function archiveReturnPath(search, kind) {
  const base = kind === "insight" ? "/insights" : `/${kind}`;
  const value = new URLSearchParams(search).get("return");
  if (!value) return base;
  try {
    const url = new URL(value, "https://archive.invalid");
    if (url.origin !== "https://archive.invalid" || url.pathname !== base)
      return base;
    const clean = new URLSearchParams();
    for (const key of ["q", "category", "year"])
      if (url.searchParams.get(key)) clean.set(key, url.searchParams.get(key));
    return base + (clean.size ? `?${clean}` : "");
  } catch {
    return base;
  }
}

export function imageCaption(alt = "") {
  const value = alt.trim();
  return !value ||
    /^(?:https?:\/\/|data:)/i.test(value) ||
    /\.(?:png|jpe?g|webp|gif|avif)(?:\?.*)?$/i.test(value) ||
    /^(?:image|图片|截图|未命名)(?:[\s_-]*\d+)?$/i.test(value)
    ? ""
    : value;
}
