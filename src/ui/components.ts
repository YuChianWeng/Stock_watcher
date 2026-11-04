/**
 * 元件（design/components.css 的實作）。規則：意義不只靠顏色 — 漲跌有 ▲▼／＋－，狀態有文字或圖示。
 */
import type { AlertRule, Direction, Holding, MarketStatus, Quote, QuoteStatus, Spark } from "../types";
import { esc } from "./dom";
import { ic } from "./icons";
import { decDir, fmtMoney, fmtPct, fmtPrice, fmtShares, fmtSigned, hhmm, hhmmss, mmdd, weekday } from "../lib/fmt";
import { stockHref } from "../router";

export const dirCls = (d: Direction | null | undefined) => (d === "up" ? "up" : d === "down" ? "dn" : "flat");
export const weakCls = (st: QuoteStatus) => (st === "stale" ? "is-stale" : st === "disconnected" ? "is-cut" : st === "closed" ? "is-closed" : "");

export function chg(q: Pick<Quote, "change" | "direction" | "limit_state">) {
  if (q.change == null) return `<span class="chg flat no-glyph">—</span>`;
  if (q.direction === "flat") return `<span class="chg flat">平盤</span>`;
  return `<span class="chg ${dirCls(q.direction)}">${fmtSigned(q.change)}</span>`;
}
export function pill(q: Pick<Quote, "change_pct" | "direction" | "limit_state">) {
  if (q.limit_state === "limit_up") return `<span class="pill solid up" title="漲停">漲停</span>`;
  if (q.limit_state === "limit_down") return `<span class="pill solid dn" title="跌停">跌停</span>`;
  if (q.change_pct == null) return `<span class="pill na">—</span>`;
  const d = dirCls(q.direction);
  return `<span class="pill ${d}">${d === "up" ? "▲" : d === "dn" ? "▼" : ""}${d === "flat" ? "0.00%" : fmtPct(q.change_pct)}</span>`;
}
const t = (iso: string | null) => (iso ? hhmmss(iso) : "");
export function statusTag(q: Pick<Quote, "status" | "as_of">, o: { showLive?: boolean; closedFull?: boolean } = {}): string {
  switch (q.status) {
    case "live": return o.showLive ? `<span class="tag live">即時</span>` : "";
    case "delayed": return `<span class="tag delayed">${ic("clock", "xs")}稍舊 <span class="num">${t(q.as_of)}</span></span>`;
    case "stale": return `<span class="tag stale">${ic("clock", "xs")}過期 <span class="num">${hhmm(q.as_of)}</span></span>`;
    case "closed": return o.closedFull ? `<span class="tag closed">收盤 <span class="num">${mmdd(q.as_of)} ${hhmm(q.as_of)}</span></span>` : "";
    case "disconnected": return `<span class="tag cut">${ic("cut", "xs")}來源中斷 <span class="num">${hhmm(q.as_of)}</span></span>`;
    case "no_data": return `<span class="tag nodata">無資料</span>`;
  }
}
export const STATUS_TEXT: Record<QuoteStatus, string> = { live: "即時", delayed: "稍舊", stale: "過期", closed: "收盤", disconnected: "來源中斷", no_data: "無資料" };

export function spark(sp: Spark | null | undefined, dir: Direction | null, base: number | null) {
  if (!sp || sp.values.length < 2) return "";
  const v = sp.values, w = 100, H = 32;
  const all = base != null && sp.kind === "intraday" ? [...v, base] : v;
  const mn = Math.min(...all), mx = Math.max(...all), span = mx - mn || 1;
  const y = (x: number) => (H - ((x - mn) / span) * (H - 4) - 2).toFixed(1);
  const d = v.map((x, i) => (i ? "L" : "M") + ((i / (v.length - 1)) * w).toFixed(1) + " " + y(x)).join("");
  const baseLine = base != null && sp.kind === "intraday" ? `<line class="base" x1="0" x2="${w}" y1="${y(base)}" y2="${y(base)}" vector-effect="non-scaling-stroke"/>` : "";
  return `<svg class="spark ${dirCls(dir)}" viewBox="0 0 ${w} ${H}" preserveAspectRatio="none" aria-hidden="true">${baseLine}<path class="a" d="${d}L${w} ${H}L0 ${H}Z"/><path class="l" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}

export function priceEl(q: Quote, cls = "") {
  if (q.last == null) return `<span class="px mu2 ${cls}">—</span>`;
  const d = q.direction === "flat" ? "flat" : dirCls(q.direction);
  return `<span class="px ${d} ${cls}">${fmtPrice(q.last)}</span>`;
}

export type RowOpt = { holding?: Holding; sel?: boolean; badge?: string; right?: string; drag?: boolean; basis?: "gross" | "net_est"; halted?: boolean };
/** 商品列：持倉（含損益）、自選、搜尋結果 */
export function qrow(sym: string, name: string, q: Quote, sp: Spark | null | undefined, o: RowOpt = {}) {
  const sub: string[] = [`<span class="code">${esc(sym)}</span>`];
  if (o.holding) sub.push(`<span class="num">${fmtShares(o.holding.qty_shares)}</span>`);
  if (q.limit_state === "limit_up") sub.push(`<span class="tag lim-up">漲停</span>`);
  if (q.limit_state === "limit_down") sub.push(`<span class="tag lim-dn">跌停</span>`);
  if (o.halted) sub.push(`<span class="tag halt">暫停交易</span>`);
  const st = statusTag(q);
  if (st) sub.push(st);
  if (o.badge) sub.push(o.badge);
  let right: string;
  if (o.right) right = o.right;
  else if (o.holding) {
    const pnl = o.basis === "net_est" ? o.holding.unrealized_pnl_net_est : o.holding.unrealized_pnl;
    right = `${priceEl(q)}<span class="pnl chg ${dirCls(decDir(pnl))} ${pnl == null ? "no-glyph" : ""}">${pnl == null ? "未有報價" : fmtMoney(pnl, { signed: true }) + " · " + fmtPct(o.holding.unrealized_pnl_pct)}</span>`;
  } else right = `${priceEl(q)}${pill(q)}`;
  const label = `${name} ${sym}，${q.last == null ? "無報價" : "現價 " + fmtPrice(q.last) + "，" + (q.direction === "flat" ? "平盤" : fmtPct(q.change_pct))}${q.status !== "live" ? "，" + STATUS_TEXT[q.status] : ""}`;
  return `<a class="qrow ${o.holding ? "hold" : ""} ${weakCls(q.status)} ${o.sel ? "sel" : ""}" href="${stockHref(sym)}" data-sym="${esc(sym)}" aria-label="${esc(label)}">
    <div class="${o.drag ? "row" : ""}" style="min-width:0">${o.drag ? `<span class="mu2 drag" data-drag aria-label="拖曳排序">${ic("drag", "s")}</span><div style="min-width:0">` : ""}<div class="nm trunc">${esc(name)}</div><div class="sub">${sub.join("")}</div>${o.drag ? "</div>" : ""}</div>
    ${o.holding ? `<div class="ext num">${fmtMoney(o.holding.market_value)}</div><div class="ext"><span class="chg ${dirCls(decDir(o.holding.day_pnl))}">${fmtMoney(o.holding.day_pnl, { signed: true })}</span></div>` : ""}
    <div class="sp">${spark(sp, q.direction, q.prev_close)}</div>
    <div class="rt">${right}</div></a>`;
}

export function idxCard(sym: string, name: string, q: Quote, sp: Spark | null | undefined, unavailable = false) {
  if (unavailable) return `<div class="card idx"><div class="nm">${esc(name)}</div><div class="val mu2">—</div><div class="xs mu"><span class="tag cut">未開通</span> 資料來源尚未開通</div></div>`;
  const d = dirCls(q.direction);
  return `<a class="card idx ${weakCls(q.status)}" href="${stockHref(sym)}" data-sym="${esc(sym)}" aria-label="${esc(name)} ${q.last == null ? "" : fmtPrice(q.last)} ${fmtPct(q.change_pct)}">
    <div class="nm">${esc(name)}${statusTag(q)}</div>
    <div class="val px ${q.direction === "flat" ? "flat" : d}">${fmtPrice(q.last)}</div>
    <div class="cr">${chg(q)}${q.change_pct != null && q.direction !== "flat" ? `<span class="chg ${d} no-glyph">${fmtPct(q.change_pct)}</span>` : ""}</div>
    <div class="sp">${spark(sp, q.direction, q.prev_close)}</div></a>`;
}

const SESSION_TEXT = { pre_open: "盤前試撮", open: "盤中", closing_auction: "收盤撮合", post: "盤後", closed: "休市" } as const;
export function marketBar(ms: MarketStatus, asOf: string | null, offlineAt?: string | null) {
  const s = ms.session;
  let sub = "";
  if (s === "open" || s === "closing_auction") sub = ms.closes_at ? `${hhmm(ms.closes_at)} 收盤` : "";
  else if (s === "pre_open") sub = ms.next_open ? `${hhmm(ms.next_open)} 開盤` : "";
  else if (s === "post") sub = "價格已定";
  if (ms.next_open && (s === "closed" || s === "post")) sub += `${sub ? " · " : ""}下次開市 ${mmdd(ms.next_open)}（${weekday(ms.next_open)}）${hhmm(ms.next_open)}`;
  const label = s === "closed" && ms.holiday_name ? `休市 · ${esc(ms.holiday_name)}` : SESSION_TEXT[s];
  const fresh = offlineAt ? `<span class="tag cut">${ic("wifioff", "xs")}離線 · 資料更新於 <span class="num">${hhmm(offlineAt)}</span></span>`
    : s === "open" || s === "closing_auction" ? `<span class="tag live">即時</span><span class="num mu xs">${hhmmss(asOf)}</span>` : `<span class="num mu xs">${asOf ? mmdd(asOf) + " " + hhmm(asOf) : ""}</span>`;
  return `<div class="mkt ${s}" role="status"><span class="dot"></span><b>${label}</b><span class="mu">${sub}</span><span class="grow"></span>${fresh}</div>`;
}

export function ruleText(r: AlertRule): string {
  const op = "op" in r ? (r.op === "gte" ? "≥" : "≤") : "";
  const s = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v);
  switch (r.type) {
    case "price": return `價格 ${op} ${fmtPrice(r.value)}`;
    case "change_pct": return `今日${r.op === "gte" ? "漲幅" : "跌幅"} ${op} ${s(r.value)}%`;
    case "pnl_pct": return `持倉損益 ${op} ${s(r.value)}%`;
    case "volume_ratio": return `爆量 ≥ ${r.value} 倍`;
    case "ma_cross": return `${r.direction === "above" ? "上穿" : "下穿"} ${r.period} 日線`;
    case "limit": return r.direction === "up" ? "漲停" : "跌停";
  }
}
export const RULE_ICON: Record<AlertRule["type"], string> = { price: "target", change_pct: "pct", pnl_pct: "brief", volume_ratio: "bolt", ma_cross: "wave", limit: "ceil" };

export function empty(icon: string, title: string, body: string, action = "") {
  return `<div class="empty"><div class="ei">${ic(icon, "l")}</div><h2 class="h2">${title}</h2><p class="sm" style="margin:0;max-width:320px">${body}</p>${action}</div>`;
}
export function skelRows(n = 3) {
  return Array.from({ length: n }, () => `<div class="row" style="padding:12px 0"><div class="grow"><div class="sk" style="height:14px;width:50%"></div><div class="sk" style="height:10px;width:30%;margin-top:8px"></div></div><div class="sk" style="width:60px;height:24px"></div><div class="sk" style="width:76px;height:28px"></div></div>`).join("");
}
export function errorBox(msg: string, retry = true) {
  return `<div class="empty"><div class="ei" style="color:var(--cut);background:var(--cut-soft);box-shadow:none">${ic("warn", "l")}</div><h2 class="h2">載入失敗</h2><p class="sm" style="margin:0">${esc(msg)}</p>${retry ? `<button class="btn o" data-act="retry">${ic("refresh", "s")}重試</button>` : ""}</div>`;
}
export const bell = (n: number) => `<a class="ibtn" href="/stocks/inbox" aria-label="通知紀錄${n ? `，${n} 則未讀` : ""}" data-bell>${ic("bell")}${n ? `<span class="badge num">${n > 99 ? "99+" : n}</span>` : ""}</a>`;
