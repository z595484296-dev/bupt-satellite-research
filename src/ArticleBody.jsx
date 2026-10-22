import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { imageCaption } from "./content-navigation.js";

const localMedia =
  /^\/media\/[a-f0-9-]+\.(png|jpg|webp|gif|avif|pdf|docx|xlsx|pptx)$/;
function safeUrl(url, key) {
  if (localMedia.test(url)) return url;
  if (key === "src") return "";
  try {
    const parsed = new URL(url);
    return ["https:", "http:", "mailto:"].includes(parsed.protocol)
      ? parsed.href
      : "";
  } catch {
    return /^#[a-z0-9-]+$/i.test(url) ? url : "";
  }
}
export function Body({ text = "", mediaUrl = (url) => url }) {
  return (
    <div className="prose rich-article">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrl}
        components={{
          h1: ({ children }) => <h2>{children}</h2>,
          img: ({ src, alt }) =>
            src ? (
              <span className="article-image">
                <img
                  src={mediaUrl(src)}
                  alt={imageCaption(alt) || "文章配图"}
                  loading="lazy"
                  decoding="async"
                />
                {imageCaption(alt) && (
                  <span className="image-caption">{imageCaption(alt)}</span>
                )}
              </span>
            ) : (
              <span>图片尚未导入网站</span>
            ),
          a: ({ href, children }) =>
            href ? (
              <a
                href={localMedia.test(href) ? mediaUrl(href) : href}
                {...(localMedia.test(href)
                  ? { download: true }
                  : { target: "_blank", rel: "noreferrer" })}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          table: ({ children }) => (
            <div
              className="article-table"
              tabIndex={0}
              role="region"
              aria-label="正文表格，可左右滚动"
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
export function Attachments({ items = [], mediaUrl = (url) => url }) {
  if (!items.length) return null;
  const displayName = (item) => {
    try {
      const source = new URL(item.name);
      return (
        decodeURIComponent(source.pathname.split("/").at(-1)) ||
        `附件.${item.type}`
      );
    } catch {
      return item.name;
    }
  };
  return (
    <section className="article-attachments" aria-label="文章附件">
      <h2>附件下载</h2>
      {items.map((a) => (
        <a key={a.url} href={mediaUrl(a.url)} download={displayName(a)}>
          <span>
            <strong>{displayName(a)}</strong>
            <small>
              {a.type?.toUpperCase()} ·{" "}
              {Math.max(1, Math.round(a.size / 1024)).toLocaleString()} KB
            </small>
          </span>
          <span aria-hidden="true">↓</span>
        </a>
      ))}
    </section>
  );
}
