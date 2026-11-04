import "./styles.css";
import { installSprite } from "./ui/icons";
import { applyPrefs, emit, initState, S, setUnread } from "./state";
import { api } from "./api/watch";
import * as store from "./lib/store";
import type { Bootstrap } from "./types";

async function start() {
  if (import.meta.env.VITE_USE_MOCK === "1") (await import("../mocks/browser")).installMock();
  installSprite();
  initState();
  const { mountApp } = await import("./app");
  // 先用快取的啟動資料（離線也能開）
  const cached = await store.get<Bootstrap>("bootstrap");
  if (cached) { S.boot = cached.data; applyPrefs(cached.data.prefs); }
  try {
    const b = await api.bootstrap();
    S.boot = b; applyPrefs(b.prefs); store.put("bootstrap", b);
  } catch (e) {
    if (!S.boot) {
      // 沒有快取也沒有網路：用預設值啟動，畫面會顯示錯誤與重試
      S.boot = { server_time: new Date().toISOString(), app_version: "?", market_status: { now: new Date().toISOString(), session: "closed", is_trading_day: false, holiday_name: null, next_open: null, closes_at: null }, prefs: { version: 0, color_convention: "tw_red_up", theme: "system", default_view: "intraday", ma_periods: [5, 20, 60], volume_pane: true, sub_indicator: "none", adjust_default: "none", pnl_basis: "gross", telegram_fallback: true, telegram_always: false }, capabilities: { intraday: true, adjusted_bars: false, corporate_actions: false, max_watch_items: 200, max_watchlists: 10, max_alerts: 100, poll_ms: { open: 5000, closed: 60000 } }, channels: { push: { vapid_public_key: "" }, telegram: { connected: false } } };
      applyPrefs(S.boot.prefs);
    }
    void e;
  }
  emit("boot");
  mountApp(document.getElementById("root")!);
  const boot = document.getElementById("boot"); if (boot) { boot.style.opacity = "0"; setTimeout(() => boot.remove(), 260); }
  api.events({ limit: 1, unread_only: true }).then((r) => setUnread(r.unread)).catch(() => {});
  registerSW();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => S.prefs && applyPrefs(S.prefs));
}

function registerSW() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV || import.meta.env.MODE === "preview") return;
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js", { scope: import.meta.env.BASE_URL }).then((reg) => {
    const ready = () => { S.updateReady = true; emit("update"); };
    if (reg.waiting && navigator.serviceWorker.controller) ready();
    reg.addEventListener("updatefound", () => { const w = reg.installing; w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) ready(); }); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  // 通知點擊：App 已開著時由 service worker postMessage 導向（§6.4）
  navigator.serviceWorker.addEventListener("message", async (e) => {
    if (e.data?.type === "navigate" && typeof e.data.url === "string") { const { navigate } = await import("./router"); navigate(e.data.url); }
    if (e.data?.type === "unread") api.events({ limit: 1, unread_only: true }).then((r) => setUnread(r.unread)).catch(() => {});
  });
}
start();
