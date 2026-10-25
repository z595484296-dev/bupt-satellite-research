// 站点动效：以观感为主，只在需要的地方动，且只动 transform / opacity / filter。
// 系统开启“减少动态效果”时全部跳过，内容直接显示。
import { useLayoutEffect, useEffect, useRef } from "react";
import { gsap } from "./vendor/gsap/index.js";
import { ScrollTrigger } from "./vendor/gsap/ScrollTrigger.js";

gsap.registerPlugin(ScrollTrigger);

const SOFT = "expo.out";
export const reduceMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

let lastKey = null; // null 表示刚打开网站；卫星展开只在直接打开首页时播放一次

/* 首屏开场：标题逐字对焦浮现 → 副标题、按钮 → 卫星从胶囊视窗展开 */
function playIntro(hero) {
  const chars = hero.querySelectorAll(".hero-char");
  const bits = hero.querySelectorAll("[data-intro-item]");
  const frame = hero.querySelector(".satellite-hero");
  const scene = hero.querySelector(".satellite-hero-plane img");
  const craft = hero.querySelector(".satellite-object img");
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.fromTo(
    chars,
    { autoAlpha: 0, yPercent: 40, filter: "blur(12px)" },
    { autoAlpha: 1, yPercent: 0, filter: "blur(0px)", duration: 1.25, stagger: 0.045, clearProps: "filter" },
    0.1,
  ).fromTo(
    bits,
    { autoAlpha: 0, y: 16, filter: "blur(6px)" },
    { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 1.1, stagger: 0.09, clearProps: "filter" },
    0.62,
  );
  if (frame && scene) {
    // 胶囊视窗展开；地球背景与卫星以不同幅度落定，展开结束后两层都静止
    tl.fromTo(frame, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: "power1.out" }, 0.5)
      .fromTo(
        frame,
        { clipPath: "inset(40% 24% 36% 36% round 999px)" },
        { clipPath: "inset(0% 0% 0% 0% round 0px)", duration: 2.1, ease: "expo.inOut", clearProps: "clipPath" },
        0.5,
      )
      .fromTo(
        scene,
        { scale: 1.14, filter: "brightness(1.14) saturate(0.82)" },
        { scale: 1, filter: "brightness(1) saturate(1)", duration: 2.8, clearProps: "transform,filter" },
        0.5,
      );
    if (craft)
      tl.fromTo(
        craft,
        { scale: 1.32, rotation: -2.5, transformOrigin: "56% 52%", filter: "brightness(1.12)" },
        { scale: 1, rotation: 0, filter: "brightness(1)", duration: 2.6, ease: "power3.out", clearProps: "transform,filter" },
        0.5,
      );
  }
  return tl;
}

/* 滚动浮现：只播放一次，回滚不重复。
   同一组（data-reveal-group）的标题、正文、按钮一起触发、依次出现，避免只出现一半；
   gated 为 true 时（首页），首屏以下的内容要等用户开始滚动才浮现。 */
const START = "top 86%";
function revealTo(el) {
  return el.dataset.reveal === "title"
    ? { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 1.3, ease: SOFT, clearProps: "filter,transform" }
    : { autoAlpha: 1, y: 0, duration: 1.2, ease: SOFT, clearProps: "transform" };
}
function revealGroup(els) {
  els.forEach((el, i) => gsap.to(el, { ...revealTo(el), delay: i * 0.09, overwrite: true }));
}
function setupReveals(root, ctx, gated) {
  const all = [...root.querySelectorAll("[data-reveal]")];
  const titles = all.filter((el) => el.dataset.reveal === "title");
  const fades = all.filter((el) => el.dataset.reveal !== "title");
  const rules = [...root.querySelectorAll("[data-rule]")];
  if (titles.length) gsap.set(titles, { autoAlpha: 0, y: 34, filter: "blur(10px)" });
  if (fades.length) gsap.set(fades, { autoAlpha: 0, y: 26 });
  if (rules.length) gsap.set(rules, { "--rule": 0 });

  const arm = () =>
    ctx.add(() => {
      const grouped = new Map(), single = [];
      all.forEach((el) => {
        const group = el.closest("[data-reveal-group]");
        if (group && root.contains(group)) {
          if (!grouped.has(group)) grouped.set(group, []);
          grouped.get(group).push(el);
        } else single.push(el);
      });
      grouped.forEach((els, group) =>
        ScrollTrigger.create({ trigger: group, start: START, once: true, onEnter: () => revealGroup(els) }),
      );
      if (single.length)
        ScrollTrigger.batch(single, {
          start: START,
          once: true,
          interval: 0.12,
          onEnter: (batch) => revealGroup(batch),
        });
      rules.forEach((el) =>
        ScrollTrigger.create({
          trigger: el.closest("[data-reveal-group]") || el,
          start: START,
          once: true,
          onEnter: () => gsap.to(el, { "--rule": 1, duration: 1.6, ease: "power3.inOut", delay: 0.15 }),
        }),
      );
    });

  if (!gated || scrollY > 4) {
    arm();
    return () => {};
  }
  const events = ["wheel", "touchmove", "scroll", "keydown"];
  const go = (event) => {
    if (event.type === "scroll" && scrollY <= 4) return;
    if (event.type === "keydown" && !["ArrowDown", "PageDown", " ", "End", "Tab"].includes(event.key)) return;
    events.forEach((type) => removeEventListener(type, go));
    arm();
  };
  events.forEach((type) => addEventListener(type, go, { passive: true }));
  return () => events.forEach((type) => removeEventListener(type, go));
}

/* 页面级：路由切换后为新页面建立动效，离开时整体还原 */
export function usePageMotion(scopeRef, key, ready) {
  useLayoutEffect(() => {
    const root = scopeRef.current;
    if (!ready || !root || reduceMotion()) return;
    let intro = null,
      disarm = () => {};
    const ctx = gsap.context((self) => {
      const hero = root.querySelector("[data-intro]");
      if (hero && lastKey === null) {
        intro = playIntro(hero);
      } else if (lastKey !== null && lastKey !== key) {
        gsap.fromTo(root, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.55, ease: "power2.out", clearProps: "all" });
      }
      lastKey = key;
      disarm = setupReveals(root, self, Boolean(hero));
    }, root);
    const refresh = () => ScrollTrigger.refresh();
    const timer = setTimeout(refresh, 700);
    addEventListener("load", refresh);
    return () => {
      clearTimeout(timer);
      removeEventListener("load", refresh);
      disarm();
      // 开发模式下 React 会立即重复执行一次 effect：开场尚未真正播放时保留“首次进入”状态
      if (intro && intro.progress() < 0.1) lastKey = null;
      ctx.revert();
    };
  }, [key, ready]);
}

/* 列表：筛选或加载更多后，只让新出现的条目柔和进场 */
export function useListMotion(listRef, signature) {
  const seen = useRef(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = [...list.querySelectorAll("[data-key]")];
    if (seen.current === null) {
      seen.current = new Set(items.map((el) => el.dataset.key));
      return;
    }
    const fresh = items.filter((el) => !seen.current.has(el.dataset.key));
    items.forEach((el) => seen.current.add(el.dataset.key));
    ScrollTrigger.refresh();
    if (reduceMotion() || !fresh.length) return;
    gsap.fromTo(
      fresh.slice(0, 14),
      { autoAlpha: 0, y: 18 },
      { autoAlpha: 1, y: 0, duration: 0.8, ease: SOFT, stagger: 0.05, overwrite: true, clearProps: "transform" },
    );
  }, [signature]);
}

/* 标签切换：底块滑动到当前标签，面板内容柔和替换，高度平滑过渡 */
export function useTabMotion({ listRef, indicatorRef, panelRef, selected, heightBefore }) {
  const previous = useRef(null);
  useLayoutEffect(() => {
    const list = listRef.current, indicator = indicatorRef.current;
    if (!list || !indicator) return;
    const place = (animate) => {
      const tab = list.querySelector('[aria-selected="true"]');
      if (!tab) return;
      const to = { x: tab.offsetLeft, y: tab.offsetTop, width: tab.offsetWidth, height: tab.offsetHeight };
      if (animate && !reduceMotion()) gsap.to(indicator, { ...to, duration: 0.7, ease: SOFT, overwrite: true });
      else gsap.set(indicator, to);
      indicator.dataset.ready = "true";
    };
    const changed = previous.current !== null && previous.current !== selected;
    place(changed);
    const panel = panelRef.current;
    if (changed && panel && !reduceMotion()) {
      const parts = panel.querySelectorAll(".direction-panel, .direction-card, .direction-empty");
      gsap.fromTo(
        parts,
        { autoAlpha: 0, y: 16, filter: "blur(6px)" },
        { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.85, ease: "power3.out", stagger: 0.07, overwrite: true, clearProps: "filter,transform" },
      );
      const h0 = heightBefore.current, h1 = panel.offsetHeight;
      if (h0 && Math.abs(h0 - h1) > 2)
        gsap.fromTo(panel, { height: h0 }, { height: h1, duration: 0.6, ease: "power3.inOut", clearProps: "height,overflow", overflow: "hidden" });
    }
    previous.current = selected;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(list);
    return () => ro.disconnect();
  }, [selected]);
}

/* 小反馈：选中、出错、成功 */
export function pop(el) {
  if (!el || reduceMotion()) return;
  gsap.fromTo(el, { scale: 0.55 }, { scale: 1, duration: 0.55, ease: "back.out(3)", clearProps: "transform" });
}
export function nudge(el) {
  if (!el || reduceMotion()) return;
  gsap.fromTo(el, { x: -8 }, { x: 0, duration: 0.7, ease: "elastic.out(1, 0.3)", clearProps: "transform" });
}
export function settle(els) {
  if (!els?.length || reduceMotion()) return;
  gsap.fromTo(els, { autoAlpha: 0, y: 18, filter: "blur(6px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.9, ease: "power3.out", stagger: 0.08, clearProps: "filter,transform" });
}

/* 阅读进度与返回顶部（不依赖动效开关，减少动态效果时同样可用） */
export function useReadingProgress(barRef, articleRef) {
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const bar = barRef.current, article = articleRef.current;
      if (!bar || !article) return;
      const rect = article.getBoundingClientRect();
      const total = rect.height - innerHeight + 64;
      const p = total > 0 ? Math.min(1, Math.max(0, (64 - rect.top) / total)) : 1;
      bar.style.transform = `scaleX(${p})`;
      bar.parentElement.dataset.visible = scrollY > 120 ? "true" : "false";
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }, []);
}
