/** 警報清單（設計稿 §5.4）：依狀態分組；啟用／暫停切換；左滑刪除。桌面右欄是通知紀錄。 */
import type { View } from "./types";
import type { Alert, AlertStatus } from "../types";
import { api } from "../api/watch";
import { WatchError } from "../api/client";
import { Poller } from "../poll";
import { S, writable } from "../state";
import { bell, empty, errorBox, RULE_ICON, ruleText, skelRows } from "../ui/components";
import { esc, isWide, on } from "../ui/dom";
import { ic } from "../ui/icons";
import { confirmDialog, toast } from "../ui/overlay";
import { title } from "../ui/top";
import { fmtPct, fmtPrice, when, ymd } from "../lib/fmt";
import { href } from "../router";
import { mountInbox } from "./inbox";
import { swipeRows } from "../ui/swipe";

const GROUPS: [AlertStatus, string][] = [["active", "啟用中"], ["paused", "已暫停"], ["triggered", "已觸發"], ["error", "錯誤"], ["expired", "已到期"]];
const FREQ = (a: Alert) => ({ once: "一次", daily: "每日一次", every: `每次 · 冷卻 ${a.cooldown_minutes} 分` })[a.frequency];

export function liveText(a: Alert): string {
  const l = a.live;
  if (!l) return "";
  if (l.met && a.status === "active") return `<span class="tag delayed">已滿足 · 等待離開條件</span>`;
  const r = a.rule;
  const cur = l.current == null ? "" : r.type === "price" || r.type === "limit" ? `現價 ${fmtPrice(l.current)}` : r.type === "ma_cross" ? `MA${r.period} ${fmtPrice(l.current)}` : r.type === "volume_ratio" ? `目前 ${l.current} 倍` : `目前 ${fmtPct(l.current)}`;
  const dist = l.distance_pct == null || r.type === "volume_ratio" ? "" : r.type === "ma_cross" ? `現價距均線 ${fmtPct(l.distance_pct)}` : `距離 ${fmtPct(l.distance_pct)}`;
  return `${dist ? `<span class="dist">${dist}</span>` : ""}${cur ? `<span class="num">${cur}</span>` : ""}`;
}

export function alertRow(a: Alert) {
  const now = S.boot?.market_status.now ?? new Date().toISOString();
  const ch = a.channels.map((c) => (c === "push" ? `${ic("phone", "xs")}推播` : `${ic("send", "xs")}TG`)).join(" ");
  const right = a.status === "active" || a.status === "paused"
    ? `<label class="tg"><input type="checkbox" data-toggle="${esc(a.alert_id)}" ${a.status === "active" ? "checked" : ""} ${writable() ? "" : "disabled"} aria-label="${a.status === "active" ? "暫停" : "啟用"}警報"><span></span></label>`
    : a.status === "triggered" ? `<button class="btn sm g" type="button" data-resume="${esc(a.alert_id)}" ${writable() ? "" : "disabled"}>重新啟用</button>`
    : `<button class="ibtn bare" type="button" data-del="${esc(a.alert_id)}" aria-label="刪除" ${writable() ? "" : "disabled"}>${ic("trash")}</button>`;
  const extra = a.status === "error" ? `<span style="color:var(--cut)">${esc(a.status_reason ?? "錯誤")}</span>` : a.status === "expired" ? `<span>${ymd(a.expires_at)} 到期</span>` : a.status === "triggered" ? `<span>${when(a.last_triggered_at, now)} 觸發</span>` : liveText(a);
  return `<div class="swipe" data-swipe="${esc(a.alert_id)}"><div class="swipe-bg"><button class="btn sm d" type="button" data-del="${esc(a.alert_id)}">${ic("trash", "s")}刪除</button></div>
    <div class="al ${a.status}"><a class="ai" href="${href("/alerts/" + a.alert_id)}" aria-hidden="true" tabindex="-1">${ic(a.status === "error" ? "warn" : RULE_ICON[a.rule.type])}</a>
    <a href="${href("/alerts/" + a.alert_id)}" style="min-width:0;color:inherit"><div class="t al-t"><span class="trunc al-n">${esc(a.name)} <span class="code">${esc(a.symbol)}</span></span><span class="al-r">${esc(ruleText(a.rule))}</span></div>
      <div class="d">${extra}<span>${FREQ(a)}</span><span>${ch}</span>${a.last_triggered_at && a.status !== "triggered" ? `<span>上次 ${when(a.last_triggered_at, now)}</span>` : ""}${a.note ? `<span class="trunc" style="max-width:160px">「${esc(a.note)}」</span>` : ""}</div></a>${right}</div></div>`;
}

const view: View = ({ el, setTop }) => {
  let rows: Alert[] | null = null, err = "";
  let tab: "alerts" | "inbox" = "alerts";
  const head = () => setTop(title("警報") + (isWide() ? "" : bell(S.unread)) + `<a class="ibtn" href="${href("/alerts/new")}" aria-label="新增警報">${ic("plus")}</a>`);
  head();
  let disposeInbox: (() => void) | null = null;
  const listHtml = () => {
    const cap = S.boot?.capabilities.max_alerts ?? 100;
    if (rows == null) return `<div class="card">${err ? errorBox(err) : skelRows(4)}</div>`;
    if (!rows.length) return `<div class="card">${empty("bell", "還沒有警報", "到價、跌破、爆量時通知你。也可以在個股頁長按圖表上的價位直接設定。", `<a class="btn p" href="${href("/alerts/new")}">${ic("plus", "s")}新增警報</a>`)}</div>`;
    return GROUPS.map(([s, t]) => { const g = rows!.filter((a) => a.status === s); return g.length ? `<h2 class="sec-t eyebrow">${t} · ${g.length}</h2><div class="card flush">${g.map(alertRow).join("")}</div>` : ""; }).join("") + `<p class="xs mu" style="text-align:center;margin-top:12px">${rows.length} / ${cap} 則 · 每個商品最多 10 則</p>`;
  };
  const drawList = () => { const l = el.querySelector("[data-list]"); if (l) l.innerHTML = listHtml(); const t = el.querySelector('[data-tab="alerts"]'); if (t && rows) t.innerHTML = `警報 <span class="num">${rows.length}</span>`; };
  const draw = () => {
    disposeInbox?.(); disposeInbox = null;
    el.innerHTML = isWide() ? `<div class="two"><div data-list></div><div data-inbox></div></div>`
      : `<div class="narrow"><div class="seg wide" role="tablist" style="margin-bottom:8px"><button type="button" data-tab="alerts" aria-pressed="${tab === "alerts"}">警報</button><button type="button" data-tab="inbox" aria-pressed="${tab === "inbox"}">通知紀錄${S.unread ? ` <span class="num">${S.unread}</span>` : ""}</button></div>${tab === "alerts" ? "<div data-list></div>" : "<div data-inbox></div>"}</div>`;
    drawList();
    const ib = el.querySelector("[data-inbox]") as HTMLElement | null;
    if (ib) disposeInbox = mountInbox(ib, { compact: true });
  };
  const load = async () => { try { rows = (await api.alerts()).rows; err = ""; } catch (e) { err = (e as Error).message; } drawList(); };
  draw(); load();
  const poller = new Poller(async () => { const r = await api.alerts(); rows = r.rows; if (!el.querySelector(".swipe.open")) drawList(); });
  const replace = (a: Alert) => { rows = rows!.map((x) => (x.alert_id === a.alert_id ? a : x)); drawList(); };
  const fail = (e: unknown) => { toast((e as Error).message, { kind: "err" }); if (e instanceof WatchError && e.code === "VERSION_CONFLICT") load(); else drawList(); };
  const del = async (id: string) => {
    const a = rows!.find((x) => x.alert_id === id)!;
    if (!(await confirmDialog("刪除警報？", `${esc(a.name)}｜${esc(ruleText(a.rule))}`, "刪除", true))) { drawList(); return; }
    try { await api.deleteAlert(id); rows = rows!.filter((x) => x.alert_id !== id); drawList(); toast("已刪除"); } catch (e) { fail(e); }
  };
  let lastWide = isWide();
  const onResize = () => { if (isWide() !== lastWide) { lastWide = isWide(); head(); draw(); } };
  window.addEventListener("resize", onResize);
  const offs = [
    on(el, "click", "[data-tab]", (b) => { tab = b.dataset.tab as typeof tab; draw(); }),
    on(el, "change", "[data-toggle]", async (t) => {
      const i = t as HTMLInputElement, a = rows!.find((x) => x.alert_id === i.dataset.toggle)!; i.disabled = true;
      try { replace(i.checked ? await api.resumeAlert(a.alert_id, a.version) : await api.pauseAlert(a.alert_id, a.version)); } catch (e) { fail(e); }
    }),
    on(el, "click", "[data-resume]", async (b) => { const a = rows!.find((x) => x.alert_id === b.dataset.resume)!; try { replace(await api.resumeAlert(a.alert_id, a.version)); toast("已重新啟用"); } catch (e) { fail(e); } }),
    on(el, "click", "[data-del]", (b) => del(b.dataset.del!)),
    on(el, "click", "[data-act=retry]", () => { err = ""; drawList(); load(); }),
    swipeRows(el),
  ];
  return () => { poller.stop(); disposeInbox?.(); offs.forEach((f) => f()); window.removeEventListener("resize", onResize); };
};
export default view;
