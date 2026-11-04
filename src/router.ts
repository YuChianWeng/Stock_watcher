/**
 * 前端路由（契約 §8）。頁面在 /stocks 之下。
 *   history 模式：真的網址（正式環境；深層連結可直接開啟）
 *   memory 模式：單檔預覽版
 */
export const BASE = "/stocks";
export type Route = { name: string; params: Record<string, string>; query: URLSearchParams; path: string };

const TABLE: [RegExp, string, string[]][] = [
  [/^\/?$/, "overview", []],
  [/^\/watch\/?$/, "watch", []],
  [/^\/holdings\/?$/, "holdings", []],
  [/^\/s\/([0-9A-Za-z]{2,8})$/, "stock", ["symbol"]],
  [/^\/market\/?$/, "market", []],
  [/^\/market\/([0-9A-Za-z]{2,8})$/, "market", ["symbol"]],
  [/^\/alerts\/?$/, "alerts", []],
  [/^\/alerts\/new$/, "alert-new", []],
  [/^\/alerts\/([^/]+)$/, "alert-edit", ["id"]],
  [/^\/inbox\/?$/, "inbox", []],
  [/^\/settings\/?$/, "settings", []],
  [/^\/settings\/notifications$/, "notifications", []],
];

export function parse(full: string): Route {
  const u = new URL(full, "http://x");
  let p = u.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  p = p.replace(/\/+$/, "") || "/";
  for (const [re, name, keys] of TABLE) {
    const m = p.match(re);
    if (m) return { name, params: Object.fromEntries(keys.map((k, i) => [k, (k === "symbol" ? decodeURIComponent(m[i + 1]).toUpperCase() : decodeURIComponent(m[i + 1]))])), query: u.searchParams, path: BASE + (p === "/" ? "/" : p) + u.search };
  }
  return { name: "notfound", params: {}, query: u.searchParams, path: BASE + p + u.search };
}

const MODE = (import.meta.env.VITE_ROUTER as string) === "memory" ? "memory" : "history";
let mem: string[] = [];
let listener: (r: Route, nav: "push" | "pop" | "replace") => void = () => {};
let depth = 0;

export function current(): Route {
  return MODE === "memory" ? parse(mem[mem.length - 1] ?? BASE + "/") : parse(location.pathname + location.search);
}
const full = (p: string) => { if (p.startsWith(BASE)) return p; return BASE + (p.startsWith("/") ? p : "/" + p); };
export function navigate(path: string, opt: { replace?: boolean } = {}) {
  const f = full(path);
  if (MODE === "memory") { if (opt.replace && mem.length) mem[mem.length - 1] = f; else mem.push(f); }
  else if (opt.replace) history.replaceState({ d: depth }, "", f);
  else history.pushState({ d: ++depth }, "", f);
  listener(current(), opt.replace ? "replace" : "push");
}
/** 能回上一頁就回上一頁（只限 App 內），否則到 fallback */
export function back(fallback = "/") {
  if (MODE === "memory") { if (mem.length > 1) { mem.pop(); listener(current(), "pop"); } else navigate(fallback, { replace: true }); return; }
  if (depth > 0) history.back(); else navigate(fallback, { replace: true });
}
export const canGoBack = () => (MODE === "memory" ? mem.length > 1 : depth > 0);
export function startRouter(onChange: typeof listener, start?: string) {
  listener = onChange;
  if (MODE === "memory") mem = [start ?? BASE + "/"];
  else {
    depth = (history.state && typeof history.state.d === "number") ? history.state.d : 0;
    window.addEventListener("popstate", (e) => { depth = e.state?.d ?? 0; listener(current(), "pop"); });
    // ?source=pwa：記錄後移除（§8）
    const u = new URL(location.href);
    if (u.searchParams.get("source") === "pwa") { try { localStorage.setItem("sw-pwa", "1"); } catch { /* */ } u.searchParams.delete("source"); history.replaceState({ d: depth }, "", u.pathname + (u.search || "")); }
  }
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.target || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const href = a.getAttribute("href")!;
    if (!href.startsWith(BASE)) return;
    e.preventDefault();
    navigate(href);
  });
  listener(current(), "replace");
}
export const href = (p: string) => BASE + (p.startsWith("/") ? p : "/" + p);
export const stockHref = (sym: string) => href((sym === "TAIEX" || sym === "TPEX" ? "/market/" : "/s/") + encodeURIComponent(sym));
