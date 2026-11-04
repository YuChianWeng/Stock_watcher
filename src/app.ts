/** App 外框：左側圖示列（≥960）、底部分頁列（手機）、頂部列、提示條、邊緣滑動返回。 */
import { back, canGoBack, current, href, navigate, startRouter, type Route } from "./router";
import { ic } from "./ui/icons";
import { $ } from "./ui/dom";
import { backBtn } from "./ui/top";
import { emit, S, sub } from "./state";
import { loginUrl } from "./api/client";
import { hhmm } from "./lib/fmt";
import { closeAllSheets } from "./ui/overlay";
import { openSearch } from "./ui/search";
import type { Ctx, View } from "./views/types";
import overview from "./views/overview";
import stock from "./views/stock";
import watch from "./views/watch";
import holdings from "./views/holdings";
import alerts from "./views/alerts";
import alertEdit from "./views/alert-edit";
import inbox from "./views/inbox";
import settings from "./views/settings";
import notifications from "./views/notifications";

const VIEWS: Record<string, View> = { overview, stock, market: stock, watch, holdings, alerts, "alert-new": alertEdit, "alert-edit": alertEdit, inbox, settings, notifications };
const NAV: [string, string, string, string[]][] = [
  ["home", "總覽", "/", ["overview", "holdings", "stock", "market"]],
  ["star", "自選", "/watch", ["watch"]],
  ["bell", "警報", "/alerts", ["alerts", "alert-new", "alert-edit", "inbox"]],
  ["gear", "設定", "/settings", ["settings", "notifications"]],
];
const SUBPAGES = new Set(["stock", "market", "alert-new", "alert-edit", "inbox", "notifications", "holdings"]);

let dispose: (() => void) | void = undefined;
let seq = 0;

export function mountApp(root: HTMLElement) {
  root.innerHTML = `<div class="app">
    <nav class="rail" aria-label="主要導覽"><a href="${href("/")}" aria-label="看盤 總覽"><img class="logo" src="${import.meta.env.BASE_URL}icon.svg" alt=""></a>
      ${NAV.map(([i, t, p]) => `<a href="${href(p)}" data-nav="${p}" aria-label="${t}">${ic(i)}<span class="tip">${t}</span></a>`).join("")}
      <button type="button" data-search aria-label="搜尋">${ic("search")}<span class="tip">搜尋</span></button>
      <span class="fill"></span>
      <a href="${href("/inbox")}" data-nav="/inbox" aria-label="通知紀錄">${ic("bell")}<span class="badge num" data-unread hidden></span><span class="tip">通知紀錄</span></a>
    </nav>
    <main class="main" id="main"><header class="top"><div class="top-in" id="top"></div></header><div class="wrapc"><div id="banners" class="stack" style="gap:8px"></div><div id="view"></div></div></main>
  </div>
  <nav class="tabbar" aria-label="分頁">${NAV.map(([i, t, p]) => `<a href="${href(p)}" data-nav="${p}">${ic(i)}<span>${t}</span>${p === "/alerts" ? '<span class="badge num" data-unread hidden></span>' : ""}</a>`).join("")}<button type="button" data-search>${ic("search")}<span>搜尋</span></button></nav>`;
  root.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-search]")) openSearch(); });
  const renderUnread = () => root.querySelectorAll<HTMLElement>("[data-unread]").forEach((b) => { b.hidden = !S.unread; b.textContent = S.unread > 99 ? "99+" : String(S.unread); });
  sub("unread", renderUnread); renderUnread();
  for (const e of ["online", "auth", "upstream", "update"] as const) sub(e, renderBanners);
  edgeSwipe($("#main")!);
  window.addEventListener("scroll", () => document.body.classList.toggle("scrolled", window.scrollY > 90), { passive: true });
  window.addEventListener("keydown", (e) => { if (e.key === "/" && !(e.target as Element).closest("input,textarea")) { e.preventDefault(); openSearch(); } });
  startRouter(show);
}

function show(r: Route) {
  const my = ++seq;
  closeAllSheets();
  try { (dispose as (() => void) | undefined)?.(); } catch { /* ignore */ }
  dispose = undefined;
  const top = $("#top")!, view = $("#view")!;
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((a) => {
    const g = NAV.find((n) => n[2] === a.dataset.nav);
    a.classList.toggle("on", a.dataset.nav === "/inbox" ? r.name === "inbox" : !!g?.[3].includes(r.name) && !(r.name === "inbox" && a.closest(".rail")));
  });
  document.body.dataset.page = r.name;
  document.body.classList.toggle("subpage", SUBPAGES.has(r.name));
  top.innerHTML = ""; view.innerHTML = "";
  view.className = "view-" + r.name;
  window.scrollTo(0, 0);
  const ctx: Ctx = {
    route: r, el: view,
    setTop: (html) => { if (my === seq) top.innerHTML = html; },
    alive: () => my === seq,
  };
  const v = VIEWS[r.name];
  if (!v) { ctx.setTop(backBtn("總覽") + `<div class="ttl"><h1 class="h1">找不到頁面</h1></div>`); view.innerHTML = `<div class="card"><div class="empty"><h2 class="h2">找不到這個頁面</h2><a class="btn o" href="${href("/")}">回總覽</a></div></div>`; return; }
  Promise.resolve(v(ctx)).then((d) => { if (my === seq) dispose = d; else d?.(); });
  renderBanners();
}


function renderBanners() {
  const el = $("#banners"); if (!el) return;
  const out: string[] = [];
  if (S.authExpired) out.push(`<div class="banner wa" role="alert">${ic("lock", "s")}<span class="grow"><b>登入已過期</b> · 尚未送出的內容已保留</span><a class="btn sm o" href="${loginUrl()}" data-login>重新登入</a></div>`);
  if (!S.online) out.push(`<div class="banner cut" role="status">${ic("wifioff", "s")}<span class="grow"><b>離線</b>${S.lastOkAt ? ` · 資料更新於 <span class="num">${hhmm(S.lastOkAt)}</span>` : ""}。新增警報、編輯自選與設定暫時停用。</span></div>`);
  else if (S.upstreamDown) out.push(`<div class="banner cut" role="status">${ic("cut", "s")}<span class="grow">行情來源暫時無法使用，顯示上次資料（資料過期），自動重試中</span></div>`);
  if (S.updateReady) out.push(`<div class="banner ac" role="status">${ic("refresh", "s")}<span class="grow">有新版本，重新開啟套用</span><button class="btn sm o" type="button" data-reload>重新開啟</button></div>`);
  el.innerHTML = out.join("");
  el.style.marginBottom = out.length ? "12px" : "0";
  el.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
  document.body.classList.toggle("ro", !S.online || S.authExpired);
}

/** iOS 主畫面 App 沒有返回鍵：從左邊緣往右滑返回 */
function edgeSwipe(main: HTMLElement) {
  let sx = 0, sy = 0, track = false;
  main.addEventListener("touchstart", (e) => { const t = e.touches[0]; track = t.clientX < 22 && document.body.classList.contains("subpage") && !(e.target as Element).closest(".chart"); sx = t.clientX; sy = t.clientY; }, { passive: true });
  main.addEventListener("touchmove", (e) => { if (!track) return; const t = e.touches[0]; const dx = t.clientX - sx; main.style.transform = dx > 0 && Math.abs(t.clientY - sy) < 50 ? `translateX(${Math.min(dx, 120) * 0.5}px)` : ""; }, { passive: true });
  main.addEventListener("touchend", (e) => {
    if (!track) return; track = false; main.style.transform = "";
    const t = e.changedTouches[0];
    if (t.clientX - sx > 80 && Math.abs(t.clientY - sy) < 60) { const fb = (document.querySelector("[data-back]") as HTMLElement | null)?.dataset.back || "/"; back(fb); }
  });
}
export { navigate, current, canGoBack, emit };
