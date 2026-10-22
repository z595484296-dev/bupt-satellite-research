import { test } from "node:test";
import assert from "node:assert/strict";
import { initialContent } from "../server/seed.mjs";
import {
  readingTarget,
  relatedEntries,
  contactPath,
  contactContext,
  groupNews,
  newestEntries,
  filterEntries,
  archiveReturnPath,
  directionContactPath,
  imageCaption,
} from "../src/content-navigation.js";

test("articles use their direct source, but uploaded text takes precedence", () => {
  const e = initialContent.entries.find(
    (item) => item.id === "spacex-commercialization",
  );
  const result = readingTarget(e, initialContent.settings.sourceUrl);
  assert.equal(result.external, true);
  assert.equal(result.isSpace, false);
  assert.match(result.href, /8f3f1d4a/);
  assert.equal(
    readingTarget({ ...e, body: "正文" }).href,
    "/insights/spacex-commercialization",
  );
  assert.equal(
    readingTarget(
      { ...e, sourceUrl: initialContent.settings.sourceUrl + "?embed=true" },
      initialContent.settings.sourceUrl,
    ).label,
    "前往公开空间",
  );
  assert.equal(
    readingTarget({ ...e, sourceUrl: "javascript:alert(1)" }).external,
    false,
  );
});

test("archive searching matches body and combined filters; chronology ignores import order", () => {
  const entries = [
    {
      id: "a",
      kind: "news",
      date: "2025-01-01",
      category: "访谈",
      body: "卫星通信 合作",
    },
    {
      id: "b",
      kind: "news",
      date: "2026-10-21",
      category: "访谈",
      body: "卫星通信 合作",
    },
    { id: "draft", kind: "news", status: "draft", date: "2027-01-01" },
  ];
  const sorted = newestEntries(entries, "news");
  assert.deepEqual(
    sorted.map((e) => e.id),
    ["b", "a"],
  );
  assert.deepEqual(
    filterEntries(sorted, {
      query: " 卫星 合作 ",
      category: "访谈",
      year: "2026",
    }).map((e) => e.id),
    ["b"],
  );
  assert.equal(entries[0].id, "a");
});

test("return links retain the selected scope without allowing external navigation", () => {
  assert.equal(
    archiveReturnPath(
      "?return=" + encodeURIComponent("/news?category=访谈&year=2026"),
      "news",
    ),
    "/news?category=%E8%AE%BF%E8%B0%88&year=2026",
  );
  assert.equal(
    archiveReturnPath("?return=https://external.example/news", "news"),
    "/news",
  );
  assert.equal(archiveReturnPath("?return=/admin", "news"), "/news");
  const direction = initialContent.settings.directions[2];
  const link = new URL(
    directionContactPath(direction, "about"),
    "https://example.org",
  );
  assert.equal(
    contactContext(link.search, [], [direction]).back,
    `/about?direction=${encodeURIComponent(direction.title)}#about-research`,
  );
  assert.equal(imageCaption("image.png"), "");
  assert.equal(imageCaption("与企业开展研究交流"), "与企业开展研究交流");
});
test("directions filter actual content, including newly published matching entries", () => {
  const { entries, settings } = initialContent;
  assert.equal(
    relatedEntries(settings.directions[2], entries)[0].id,
    "beijing-industry",
  );
  assert.ok(
    relatedEntries(settings.directions[2], entries).some(
      (e) => e.id === "satellite-resources",
    ),
  );
  assert.equal(
    relatedEntries(settings.directions[0], entries)[0].id,
    "operator-ai-strategy",
  );
  assert.equal(relatedEntries(settings.directions[3], entries).length, 0);
  const added = {
    id: "new-case",
    title: "航空应用案例",
    kind: "research",
    status: "published",
  };
  assert.equal(
    relatedEntries(settings.directions[3], [...entries, added])[0].id,
    "new-case",
  );
  assert.equal(
    relatedEntries(settings.directions[3], [
      ...entries,
      { ...added, status: "draft" },
    ]).length,
    0,
  );
});
test("cooperation context accepts published entries and configured directions only", () => {
  const { entries, settings } = initialContent;
  const entry = entries[0];
  const search = new URL(contactPath(entry), "https://example.org").search;
  assert.equal(
    contactContext(search, entries, settings.directions).title,
    entry.title,
  );
  assert.equal(
    contactContext(
      "?topic=missing&direction=arbitrary",
      entries,
      settings.directions,
    ),
    null,
  );
  assert.equal(
    contactContext(
      "?topic=satellite-business-model",
      [{ ...entry, status: "draft" }],
      [],
    ),
    null,
  );
  assert.equal(
    contactContext(
      "?direction=" + encodeURIComponent(settings.directions[3].title),
      entries,
      settings.directions,
    ).title,
    settings.directions[3].title,
  );
});
test("news archive groups recent years first without mutating CMS order", () => {
  const entries = [
    { id: "a", kind: "news", date: "2024-12" },
    { id: "b", kind: "news", date: "2026-01-04" },
    { id: "c", kind: "news", date: "" },
  ];
  assert.deepEqual(
    groupNews(entries).map(([year]) => year),
    ["2026", "2024", "未注明日期"],
  );
  assert.equal(entries[0].id, "a");
});
