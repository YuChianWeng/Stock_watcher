/** 全域狀態：啟動資料、偏好、連線、登入、未讀數。 */
import type { Bootstrap, Prefs, SessionKind } from "./types";
import { api } from "./api/watch";
import { onClientEvent, WatchError } from "./api/client";

type Ev = "prefs" | "online" | "auth" | "unread" | "upstream" | "update" | "boot";
const subs = new Map<Ev, Set<() => void>>();
export const sub = (e: Ev, f: () => void) => { if (!subs.has(e)) subs.set(e, new Set()); subs.get(e)!.add(f); return () => subs.get(e)!.delete(f); };
export const emit = (e: Ev) => subs.get(e)?.forEach((f) => f());

export const S = {
  boot: null as Bootstrap | null,
  prefs: null as Prefs | null,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  authExpired: false,
  upstreamDown: false,
  unread: 0,
  updateReady: false,
  lastOkAt: null as string | null,
};

export const session = (): SessionKind => S.boot?.market_status.session ?? "closed";
export const isTradingSession = () => ["open", "closing_auction", "pre_open"].includes(session());
export const pollMs = () => {
  const p = S.boot?.capabilities.poll_ms ?? { open: 5000, closed: 60000 };
  return isTradingSession() ? p.open : p.closed;
};

export function applyPrefs(p: Prefs) {
  S.prefs = p;
  const root = document.documentElement;
  if (p.theme === "system") delete root.dataset.theme; else root.dataset.theme = p.theme;
  if (p.color_convention === "intl_green_up") root.dataset.colors = "intl"; else delete root.dataset.colors;
  try { localStorage.setItem("sw-theme", p.theme); localStorage.setItem("sw-colors", p.color_convention); } catch { /* ignore */ }
  const dark = p.theme === "dark" || (p.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#05070D" : "#F2F5FB"));
  emit("prefs");
}

/** 寫入偏好：樂觀更新，失敗時還原（離線時停用） */
export async function savePrefs(patch: Partial<Prefs>) {
  if (!S.prefs) return;
  const prev = S.prefs;
  applyPrefs({ ...prev, ...patch });
  try { applyPrefs(await api.putPrefs({ ...prev, ...patch })); }
  catch (e) {
    if (e instanceof WatchError && e.code === "VERSION_CONFLICT") { const fresh = await api.prefs(); applyPrefs({ ...fresh, ...patch }); applyPrefs(await api.putPrefs({ ...fresh, ...patch })); return; }
    applyPrefs(prev); throw e;
  }
}

export function setUnread(n: number) {
  S.unread = n; emit("unread");
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { if (n > 0) nav.setAppBadge?.(n)?.catch(() => {}); else nav.clearAppBadge?.()?.catch(() => {}); } catch { /* 不支援就忽略 */ }
}

export function initState() {
  S.online = navigator.onLine;
  window.addEventListener("online", () => { S.online = true; emit("online"); });
  window.addEventListener("offline", () => { S.online = false; emit("online"); });
  onClientEvent((e) => {
    if (e.type === "auth-expired" && !S.authExpired) { S.authExpired = true; emit("auth"); }
    if (e.type === "net-fail" && !navigator.onLine && S.online) { S.online = false; emit("online"); }
    if (e.type === "ok") { S.lastOkAt = new Date().toISOString(); if (S.authExpired) { S.authExpired = false; emit("auth"); } if (!S.online && navigator.onLine) { S.online = true; emit("online"); } }
  });
}
export const writable = () => S.online && !S.authExpired;
