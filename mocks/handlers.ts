/**
 * Mock 後端（只用於開發、預覽與測試）。依 FRONTEND-CONTRACT v1.0 回應，資料全部虛構（§7）。
 * MOCK_NOW 之類的字串不得出現在正式版 bundle（CI 會檢查）。
 */
import type {
  Alert, AlertEvent, AlertRule, Bar, Bootstrap, Holding, Instrument, InstrumentKind, MarketStatus, Prefs, PushDevice,
  Quote, QuoteStatus, SessionKind, Spark, Trade, Watchlist, WatchItem,
} from "../src/types";
import { aggregate, genDaily, genIntraday, rng, tradingDays } from "./gen-bars";
import { snapPrice, stepPrice, tickSize } from "../src/lib/ticks";
import { sma } from "../src/lib/indicators";

export type MockResponse = { status: number; body: unknown; headers?: Record<string, string> };
export const ok = (data: unknown, status = 200): MockResponse => ({ status, body: { version: 1, data } });
export const fail = (status: number, code: string, message: string, details: unknown[] = [], headers?: Record<string, string>): MockResponse =>
  ({ status, body: { version: 1, error: { code, message, details } }, headers });

// ── 情境 ──
export type MockSession = "open" | "pre_open" | "closing_auction" | "post" | "closed";
export type MockFlags = { session: MockSession; empty: boolean; extreme: boolean; noDevices: boolean; tpexDown: boolean; adjusted: boolean; halfDay: boolean };
export const DEFAULT_FLAGS: Readonly<MockFlags> = { session: "open", empty: false, extreme: false, noDevices: false, tpexDown: false, adjusted: false, halfDay: false };
export const flags: MockFlags = { ...DEFAULT_FLAGS };

const TODAY = "2026-11-04", PREV_DAY = "2026-11-03";
const SESSION_NOW: Record<MockSession, string> = {
  open: `${TODAY}T11:32:05+08:00`, pre_open: `${TODAY}T08:47:12+08:00`, closing_auction: `${TODAY}T13:27:10+08:00`,
  post: `${TODAY}T13:52:00+08:00`, closed: `${TODAY}T10:00:00+08:00`,
};
export const MOCK_NOW = () => SESSION_NOW[flags.session];
const isTradingDay = () => flags.session !== "closed";
const lastDate = () => (flags.session === "closed" || flags.session === "pre_open" ? PREV_DAY : TODAY);
const minutesNow = () => ({ open: 152, pre_open: -1, closing_auction: 265, post: 270, closed: 270 })[flags.session];
const ago = (sec: number) => new Date(new Date(MOCK_NOW()).getTime() - sec * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const toTpe = (iso: string) => { const d = new Date(new Date(iso).getTime() + 8 * 3600e3); return d.toISOString().slice(0, 19) + "+08:00"; };

export function marketStatus(): MarketStatus {
  const s = flags.session;
  return {
    now: MOCK_NOW(), session: s as SessionKind, is_trading_day: isTradingDay(),
    holiday_name: s === "closed" ? "示範休市日" : null,
    next_open: s === "closed" ? "2026-11-05T09:00:00+08:00" : s === "pre_open" ? `${TODAY}T09:00:00+08:00` : s === "post" ? "2026-11-05T09:00:00+08:00" : null,
    closes_at: s === "open" || s === "closing_auction" ? `${TODAY}T13:30:00+08:00` : null,
  };
}

// ── 商品 ──
type Def = { symbol: string; name: string; kind: InstrumentKind; board: Instrument["board"]; industry: string | null; prev: number; last: number | null; lots: number; status?: QuoteStatus; age?: number; flags?: string[]; days?: number };
const DEFS: Def[] = [
  { symbol: "TS01", name: "示範半導體", kind: "stock", board: "tse", industry: "半導體", prev: 98, last: 100.5, lots: 32000 },
  { symbol: "TS02", name: "範例金融控股", kind: "stock", board: "tse", industry: "金融", prev: 25.4, last: 23.8, lots: 54000, status: "stale", age: 184 },
  { symbol: "TS03", name: "虛構電子", kind: "stock", board: "otc", industry: "電子零組件", prev: 312, last: 312, lots: 9000, status: "delayed", age: 32 },
  { symbol: "TS04", name: "樣本航運", kind: "stock", board: "tse", industry: "航運", prev: 50, last: 55, lots: 88000 },
  { symbol: "TS05", name: "假想生技", kind: "stock", board: "otc", industry: "生技醫療", prev: 20.2, last: 18.2, lots: 12000 },
  { symbol: "TS06", name: "示範光電", kind: "stock", board: "tse", industry: "光電", prev: 64.3, last: 65.1, lots: 7000, status: "disconnected", age: 420 },
  { symbol: "TS07", name: "範例新創", kind: "stock", board: "otc", industry: "資訊服務", prev: 0, last: null, lots: 2000, status: "no_data", days: 40 },
  { symbol: "TS08", name: "虛構重工", kind: "stock", board: "tse", industry: "機械", prev: 41.2, last: 41.2, lots: 0, flags: ["halted"] },
  { symbol: "TS09", name: "示範臺灣永續高股息低波動精選三十 ETF 連結基金", kind: "stock", board: "tse", industry: "其他", prev: 1180, last: 1235, lots: 1_250_000 },
  { symbol: "TE01", name: "示範市值 ETF", kind: "etf", board: "tse", industry: null, prev: 149.5, last: 150, lots: 15000 },
  { symbol: "TE02", name: "範例高股息 ETF", kind: "etf", board: "tse", industry: null, prev: 22.5, last: 22.35, lots: 41000 },
  { symbol: "TAIEX", name: "加權指數（示範）", kind: "index", board: "index", industry: null, prev: 9950, last: 10000, lots: 0 },
  { symbol: "TPEX", name: "櫃買指數（示範）", kind: "index", board: "index", industry: null, prev: 251.25, last: 250, lots: 0 },
];
const DEF = new Map(DEFS.map((d) => [d.symbol, d]));
export const SYMBOLS = DEFS.map((d) => d.symbol);

const limits = (d: Def) => {
  if (d.kind === "index" || !d.prev) return { up: null, dn: null };
  const t = tickSize(d.prev * 1.1, d.kind);
  return { up: Math.floor((d.prev * 1.1) / t + 1e-9) * t, dn: Math.ceil((d.prev * 0.9) / tickSize(d.prev * 0.9, d.kind) - 1e-9) * tickSize(d.prev * 0.9, d.kind) };
};
const r2 = (v: number) => Math.round(v * 100) / 100;

// 動態價格狀態
type Live = { last: number | null; high: number | null; low: number | null; open: number | null; vol: number };
const live = new Map<string, Live>();
function liveOf(d: Def): Live {
  let l = live.get(d.symbol);
  if (!l) {
    const lim = limits(d);
    let last = d.last;
    if (d.symbol === "TS04") last = lim.up; // 漲停
    if (d.symbol === "TS05") last = lim.dn; // 跌停
    l = { last, open: last == null ? null : r2(d.prev * 1.004), high: last == null ? null : r2(Math.max(last, d.prev) * 1.006), low: last == null ? null : r2(Math.min(last, d.prev) * 0.995), vol: Math.round(d.lots * 0.56) };
    if (l.open != null && d.kind !== "index") { l.open = snapPrice(l.open, d.kind); l.high = snapPrice(l.high!, d.kind); l.low = snapPrice(l.low!, d.kind); }
    if (lim.up != null && l.high != null) l.high = Math.min(l.high, lim.up);
    if (lim.dn != null && l.low != null) l.low = Math.max(l.low, lim.dn);
    live.set(d.symbol, l);
  }
  return l;
}
const tick = rng(77);
/** 每次輪詢讓 live 的商品跳一檔（展示用） */
function nudge() {
  if (flags.session !== "open" && flags.session !== "closing_auction") return;
  for (const d of DEFS) {
    const st = statusOf(d);
    if (st !== "live" || d.flags?.includes("halted") || d.symbol === "TS04" || d.symbol === "TS05") continue;
    const l = liveOf(d);
    if (l.last == null || tick() < 0.45) continue;
    const dir = tick() < 0.5 ? 1 : -1;
    const lim = limits(d);
    let nx = d.kind === "index" ? r2(l.last * (1 + dir * 0.0003)) : stepPrice(l.last, dir as 1 | -1, d.kind);
    if (lim.up != null && nx > lim.up) nx = lim.up;
    if (lim.dn != null && nx < lim.dn) nx = lim.dn;
    l.last = nx; l.high = Math.max(l.high ?? nx, nx); l.low = Math.min(l.low ?? nx, nx); l.vol += Math.round(d.lots / 400);
  }
}
function statusOf(d: Def): QuoteStatus {
  if (d.status === "no_data") return "no_data";
  if (flags.session === "pre_open" || flags.session === "post" || flags.session === "closed") return "closed";
  if (d.symbol === "TPEX" && flags.tpexDown) return "disconnected";
  return d.status ?? "live";
}
export function quoteOf(sym: string): Quote {
  const d = DEF.get(sym)!;
  const l = liveOf(d), st = statusOf(d), lim = limits(d);
  const last = l.last, prev = d.prev || null;
  const change = last != null && prev != null ? r2(last - prev) : null;
  const pct = change != null && prev ? r2((change / prev) * 100) : null;
  const closedAsOf = flags.session === "post" ? `${TODAY}T13:30:00+08:00` : `${PREV_DAY}T13:30:00+08:00`;
  const age = st === "closed" ? null : d.age ?? (d.kind === "index" ? 5 : 3);
  return {
    symbol: sym, last, prev_close: prev, open: l.open, high: l.high, low: l.low,
    change, change_pct: pct, direction: change == null ? null : change > 0 ? "up" : change < 0 ? "down" : "flat",
    limit_up: lim.up, limit_down: lim.dn,
    limit_state: last != null && lim.up != null && last >= lim.up ? "limit_up" : last != null && lim.dn != null && last <= lim.dn ? "limit_down" : null,
    volume_lots: d.kind === "index" || st === "no_data" ? null : l.vol,
    turnover_twd: st === "no_data" ? null : d.kind === "index" ? (d.symbol === "TAIEX" ? 246_100_000_000 : 41_200_000_000) : Math.round(l.vol * 1000 * (last ?? 0)),
    as_of: st === "no_data" ? null : st === "closed" ? closedAsOf : toTpe(ago(age ?? 0)),
    fetched_at: MOCK_NOW(), age_seconds: st === "no_data" ? null : age,
    status: st, session: flags.session as SessionKind, source: d.kind === "index" ? "twse" : "kgi",
  };
}
const instrumentOf = (sym: string): Instrument => { const d = DEF.get(sym)!; return { symbol: d.symbol, name: d.name, kind: d.kind, board: d.board, industry: d.industry, lot_size: d.kind === "index" ? null : 1000, flags: d.flags ?? [] }; };

// ── K 線、分時 ──
const barCache = new Map<string, Bar[]>();
function daily(sym: string): Bar[] {
  const key = sym + lastDate() + flags.session;
  let b = barCache.get(key);
  if (!b) {
    const d = DEF.get(sym)!;
    const last = liveOf(d).last ?? (d.symbol === "TS07" ? 38.5 : d.prev);
    const partial = flags.session === "open" || flags.session === "closing_auction";
    b = genDaily({ symbol: sym, kind: d.kind, last, days: d.days ?? 1000, end: lastDate(), baseLots: Math.max(500, d.lots), partial });
    if (d.symbol !== "TS07" && d.prev) {
      // 讓前一根的收盤 = 昨收（避免和報價對不起來）
      const pi = b.length - 2; if (pi >= 0 && lastDate() === TODAY) { b[pi].c = d.prev; b[pi].h = Math.max(b[pi].h, d.prev); b[pi].l = Math.min(b[pi].l, d.prev); }
    }
    barCache.set(key, b);
  }
  // 最後一根跟著報價
  const q = liveOf(DEF.get(sym)!);
  const lb = b[b.length - 1];
  if (lb.partial && q.last != null) { lb.c = q.last; lb.h = Math.max(lb.h, q.last); lb.l = Math.min(lb.l, q.last); }
  return b;
}
/**
 * 向前還原（mock）：每年 7 月第一個交易日視為除息日，股利固定為除息前收盤的 3%（ETF 4%），
 * 除息日之前的 OHLC 乘上累積還原因子；指數不還原。
 */
export function adjustForward(bars: Bar[], sym: string): Bar[] {
  const d = DEF.get(sym)!;
  if (d.kind === "index") return bars;
  const yieldPct = d.kind === "etf" ? 0.04 : 0.03;
  const out = bars.map((b) => ({ ...b }));
  let factor = 1;
  for (let i = out.length - 1; i > 0; i--) {
    const exDiv = out[i].t.slice(5, 7) === "07" && out[i - 1].t.slice(5, 7) === "06";
    if (exDiv) factor *= 1 - yieldPct;
    if (factor !== 1) {
      const b = out[i - 1], k = factor, snap = (v: number) => snapPrice(v * k, d.kind);
      b.o = snap(b.o); b.h = snap(b.h); b.l = snap(b.l); b.c = snap(b.c);
    }
  }
  return out;
}

export function sparkOf(sym: string): Spark | null {
  const d = DEF.get(sym)!;
  if (statusOf(d) === "no_data") return null;
  if (flags.session === "pre_open") return { kind: "daily", values: daily(sym).slice(-40).map((b) => b.c) };
  const pts = intradayPoints(sym);
  if (!pts.length) return null;
  const step = Math.max(1, Math.ceil(pts.length / 40));
  const vals = pts.filter((_, i) => i % step === 0).map((p) => p.p);
  vals[vals.length - 1] = pts[pts.length - 1].p;
  return { kind: "intraday", values: vals.slice(-40) };
}
function intradayPoints(sym: string) {
  const d = DEF.get(sym)!, m = minutesNow();
  if (m < 0 || statusOf(d) === "no_data" || !d.prev) return [];
  const l = liveOf(d);
  const pts = genIntraday(sym, lastDate(), d.prev, l.last ?? d.prev, m, d.kind, Math.max(500, d.lots));
  if (sym === "TS06") return pts.slice(0, 95); // 來源中斷：停在 10:35
  return pts;
}

// ── 資料庫 ──
type DB = {
  prefs: Prefs; watchlists: Watchlist[]; holdings: { symbol: string; qty: number; cost: number; first: string }[];
  alerts: Alert[]; events: AlertEvent[]; devices: PushDevice[]; trades: Trade[]; idem: Map<string, MockResponse>; seq: number;
};
export let db: DB;
const iso = (s: string) => s;
function wl(id: string, name: string, pos: number, syms: string[]): Watchlist {
  return { watchlist_id: id, name, position: pos, version: 1, items: syms.map((s) => ({ symbol: s, name: DEF.get(s)!.name, kind: DEF.get(s)!.kind, added_at: "2026-10-01T09:00:00+08:00" } as WatchItem)) };
}
function rule(r: AlertRule) { return r; }
function mkAlert(id: string, sym: string, r: AlertRule, p: Partial<Alert>): Alert {
  return { alert_id: id, version: 1, symbol: sym, name: DEF.get(sym)!.name, rule: r, frequency: "every", cooldown_minutes: 30, channels: ["push"], note: null, status: "active", status_reason: null, expires_at: null, created_at: "2026-10-20T20:11:00+08:00", updated_at: "2026-10-20T20:11:00+08:00", last_triggered_at: null, trigger_count: 0, live: null, ...p };
}
export function resetDb() {
  live.clear(); barCache.clear();
  db = {
    seq: 100, idem: new Map(),
    prefs: { version: 1, color_convention: "tw_red_up", theme: "system", default_view: "intraday", ma_periods: [5, 20, 60], volume_pane: true, sub_indicator: "kd", adjust_default: "none", pnl_basis: "gross", telegram_fallback: true, telegram_always: false },
    watchlists: flags.empty ? [wl("wl_default", "觀察中", 0, [])] : [wl("wl_default", "觀察中", 0, ["TS04", "TS03", "TS05", "TE02", "TS06", "TS08", "TS09"]), wl("wl_etf", "ETF", 1, []), wl("wl_swing", "短線", 2, ["TS01", "TS07", "TE01"])],
    holdings: flags.empty ? [] : [
      { symbol: "TS01", qty: 3000, cost: 270_385, first: "2025-03-12" },
      { symbol: "TE01", qty: 1234, cost: 183_870, first: "2025-08-01" },
      { symbol: "TS02", qty: 5000, cost: 140_200, first: "2024-11-20" },
      { symbol: "TS07", qty: 1000, cost: 41_060, first: "2026-10-28" },
      ...(flags.extreme ? [{ symbol: "TS09", qty: 120_000, cost: 21_400_000, first: "2019-05-02" }] : []),
    ],
    alerts: flags.empty ? [] : [
      mkAlert("al_1", "TS01", rule({ type: "price", op: "gte", value: 105 }), { channels: ["push"], note: "突破前高" }),
      mkAlert("al_2", "TS02", rule({ type: "change_pct", op: "lte", value: -5 }), { frequency: "daily", channels: ["push", "telegram"], last_triggered_at: `${TODAY}T11:02:00+08:00`, trigger_count: 1 }),
      mkAlert("al_3", "TS03", rule({ type: "volume_ratio", value: 2 }), { frequency: "once", channels: ["telegram"] }),
      mkAlert("al_4", "TE01", rule({ type: "ma_cross", period: 20, direction: "below" }), { status: "paused", cooldown_minutes: 60 }),
      mkAlert("al_5", "TS04", rule({ type: "limit", direction: "up" }), { frequency: "once", status: "triggered", last_triggered_at: `${TODAY}T10:12:00+08:00`, trigger_count: 1 }),
      mkAlert("al_6", "TS01", rule({ type: "pnl_pct", op: "gte", value: 20 }), { frequency: "once" }),
      mkAlert("al_7", "TS05", rule({ type: "pnl_pct", op: "lte", value: -10 }), { status: "error", status_reason: "持倉已清空" }),
      mkAlert("al_8", "TE02", rule({ type: "price", op: "lte", value: 21 }), { status: "expired", expires_at: "2026-10-31T13:30:00+08:00" }),
    ],
    events: flags.empty ? [] : [
      ev("ev_5", "al_1", "TS01", { type: "price", op: "gte", value: 100 }, `${TODAY}T10:41:00+08:00`, false, 100.5, 2.55, "live", [["push", "sent", null], ["telegram", "skipped", "此警報未選 Telegram"]], null),
      ev("ev_4", "al_2", "TS02", { type: "change_pct", op: "lte", value: -5 }, `${TODAY}T11:02:00+08:00`, true, 23.8, -6.3, "delayed", [["push", "failed", "裝置訂閱失效"], ["telegram", "sent", null]], null),
      ev("ev_3", "al_5", "TS04", { type: "limit", direction: "up" }, `${TODAY}T10:12:00+08:00`, false, 55, 10, "live", [["push", "sent", null]], null),
      ev("ev_2", "al_4", "TE01", { type: "ma_cross", period: 20, direction: "below" }, `${PREV_DAY}T13:21:00+08:00`, false, 148.2, -0.87, "live", [["push", "sent", null]], `${PREV_DAY}T20:00:00+08:00`),
      ev("ev_1", "al_3", "TS03", { type: "volume_ratio", value: 2 }, "2026-10-30T10:05:00+08:00", false, 312, 0, "live", [["telegram", "sent", null]], "2026-10-30T12:00:00+08:00"),
    ],
    devices: flags.noDevices ? [] : [
      { device_id: "dev_1", label: "這台 iPhone", created_at: "2026-10-01T21:00:00+08:00", last_ok_at: `${TODAY}T10:41:00+08:00`, state: "active", is_current: true },
      { device_id: "dev_2", label: "iPad Pro", created_at: "2026-10-03T21:00:00+08:00", last_ok_at: `${PREV_DAY}T13:20:00+08:00`, state: "active", is_current: false },
      { device_id: "dev_3", label: "舊 iPhone", created_at: "2025-12-01T21:00:00+08:00", last_ok_at: "2026-10-02T09:12:00+08:00", state: "revoked", is_current: false },
    ],
    trades: [
      tr("t1", "TS01", "buy", 2000, "88.50", "2025-03-12"), tr("t2", "TS01", "buy", 1000, "93.00", "2025-09-02"),
      tr("t3", "TE01", "buy", 1000, "148.00", "2025-08-01"), tr("t4", "TE01", "buy", 234, "153.50", "2026-02-10"),
      tr("t5", "TS02", "buy", 6000, "27.90", "2024-11-20"), tr("t6", "TS02", "sell", 1000, "29.10", "2025-06-18"),
      tr("t7", "TS07", "buy", 1000, "41.00", "2026-10-28"),
    ],
  };
}
function ev(id: string, alert: string, sym: string, r: AlertRule, at: string, late: boolean, last: number, pct: number, ds: QuoteStatus, dl: [string, string, string | null][], read: string | null): AlertEvent {
  const name = DEF.get(sym)!.name;
  return {
    event_id: id, alert_id: alert, symbol: sym, name, rule: r, fired_at: at, late,
    observed: { last, change_pct: pct, value: null, data_status: ds, as_of: at },
    message: { title: `${name} ${sym}｜${ruleText(r)}`, body: `現價 ${last.toFixed(2)}（${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}%）· ${at.slice(11, 16)} · ${late ? "延後補發" : "即時"}` },
    deliveries: dl.map(([c, s, r2]) => ({ channel: c as "push", state: s as "sent", reason: r2 })), read_at: read,
  };
}
function tr(id: string, sym: string, side: "buy" | "sell", qty: number, price: string, date: string): Trade {
  const amt = Number(price) * qty, fee = Math.max(20, Math.round(amt * 0.001425)), tax = side === "sell" ? Math.round(amt * (DEF.get(sym)!.kind === "etf" ? 0.001 : 0.003)) : 0;
  return { trade_id: id, symbol: sym, name: DEF.get(sym)!.name, side, qty_shares: qty, price, fee: fee.toFixed(2), tax: tax.toFixed(2), net_amount: (side === "buy" ? -(amt + fee) : amt - fee - tax).toFixed(2), trade_date: date, settle_date: date, source: "import" };
}
export function ruleText(r: AlertRule): string {
  const op = "op" in r ? (r.op === "gte" ? "≥" : "≤") : "";
  const s = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v);
  switch (r.type) {
    case "price": return `價格 ${op} ${r.value.toFixed(2)}`;
    case "change_pct": return `今日${r.op === "gte" ? "漲幅" : "跌幅"} ${op} ${s(r.value)}%`;
    case "pnl_pct": return `持倉損益 ${op} ${s(r.value)}%`;
    case "volume_ratio": return `爆量 ≥ ${r.value} 倍`;
    case "ma_cross": return `${r.direction === "above" ? "上穿" : "下穿"} ${r.period} 日線`;
    case "limit": return r.direction === "up" ? "漲停" : "跌停";
  }
}
resetDb();

// ── 計算 ──
const money = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
function holdingOf(h: DB["holdings"][number], totalMv: number): Holding {
  const d = DEF.get(h.symbol)!, q = quoteOf(h.symbol);
  const mv = q.last != null ? q.last * h.qty : null;
  const pnl = mv != null ? mv - h.cost : null;
  const sellCost = mv != null ? Math.max(20, mv * 0.001425) + mv * (d.kind === "etf" ? 0.001 : 0.003) : null;
  const day = q.change != null ? q.change * h.qty : null;
  return {
    symbol: h.symbol, name: d.name, kind: d.kind, qty_shares: h.qty,
    avg_cost: (h.cost / h.qty).toFixed(4), cost: money(h.cost),
    market_value: mv == null ? null : money(mv), unrealized_pnl: pnl == null ? null : money(pnl),
    unrealized_pnl_pct: pnl == null ? null : r2((pnl / h.cost) * 100),
    unrealized_pnl_net_est: pnl == null || sellCost == null ? null : money(pnl - sellCost),
    day_pnl: day == null ? null : money(day), day_pnl_pct: q.change_pct,
    weight_pct: mv == null || !totalMv ? null : r2((mv / totalMv) * 100),
    first_buy_date: h.first, quote: q, spark: sparkOf(h.symbol),
  };
}
function holdings(): Holding[] {
  const mvs = db.holdings.map((h) => { const q = quoteOf(h.symbol); return q.last != null ? q.last * h.qty : 0; });
  const total = mvs.reduce((a, b) => a + b, 0);
  return db.holdings.map((h) => holdingOf(h, total));
}
function summary(hs: Holding[]) {
  if (!hs.length) return null;
  const n = (s: string | null) => (s == null ? 0 : Number(s));
  const priced = hs.filter((h) => h.market_value != null);
  const mv = priced.reduce((a, h) => a + n(h.market_value), 0), cost = priced.reduce((a, h) => a + n(h.cost), 0);
  const pnl = mv - cost, day = priced.reduce((a, h) => a + n(h.day_pnl), 0), net = priced.reduce((a, h) => a + n(h.unrealized_pnl_net_est), 0);
  return {
    as_of: MOCK_NOW(), market_value: money(mv), cost: money(cost), unrealized_pnl: money(pnl), unrealized_pnl_pct: cost ? r2((pnl / cost) * 100) : null,
    unrealized_pnl_net_est: money(net), day_pnl: money(day), day_pnl_pct: mv - day ? r2((day / (mv - day)) * 100) : null, realized_pnl_ytd: "5820.00",
    holdings_count: hs.length, unpriced_count: hs.filter((h) => h.quote.last == null).length,
    stale_count: hs.filter((h) => h.quote.status === "stale" || h.quote.status === "disconnected").length,
  };
}
const watchOut = (w: Watchlist): Watchlist => ({ ...w, items: w.items.map((i) => ({ ...i, quote: quoteOf(i.symbol), spark: sparkOf(i.symbol) })) });

function avgVol5(sym: string) { const b = daily(sym).filter((x) => !x.partial).slice(-5); return b.length && b[0].v_lots != null ? Math.round(b.reduce((a, x) => a + (x.v_lots ?? 0), 0) / b.length) : null; }
function maOf(sym: string, p: number) { const c = daily(sym).map((b) => b.c); return sma(c, p).at(-1) ?? null; }

export function evalRule(sym: string, r: AlertRule): { current: number | null; distance_pct: number | null; met: boolean } {
  const q = quoteOf(sym);
  const last = q.last;
  switch (r.type) {
    case "price": return { current: last, distance_pct: last ? r2(((r.value - last) / last) * 100) : null, met: last != null && (r.op === "gte" ? last >= r.value : last <= r.value) };
    case "change_pct": { const c = q.change_pct; return { current: c, distance_pct: c == null ? null : r2(r.value - c), met: c != null && (r.op === "gte" ? c >= r.value : c <= r.value) }; }
    case "pnl_pct": { const h = holdings().find((x) => x.symbol === sym); const c = h?.unrealized_pnl_pct ?? null; return { current: c, distance_pct: c == null ? null : r2(r.value - c), met: c != null && (r.op === "gte" ? c >= r.value : c <= r.value) }; }
    case "volume_ratio": { const a = avgVol5(sym); const c = a && q.volume_lots != null ? r2(q.volume_lots / a) : null; return { current: c, distance_pct: c ? r2(((r.value - c) / c) * 100) : null, met: c != null && c >= r.value }; }
    case "ma_cross": { const m = maOf(sym, r.period); return { current: m == null ? null : r2(m), distance_pct: m && last ? r2(((last - m) / m) * 100) : null, met: m != null && last != null && (r.direction === "above" ? last > m : last < m) }; }
    case "limit": { const lim = r.direction === "up" ? q.limit_up : q.limit_down; return { current: last, distance_pct: lim && last ? r2(((lim - last) / last) * 100) : null, met: q.limit_state === (r.direction === "up" ? "limit_up" : "limit_down") }; }
  }
}
const alertOut = (a: Alert): Alert => ({ ...a, live: a.status === "error" || a.status === "expired" ? null : evalRule(a.symbol, a.rule) });

function validateRule(sym: string, r: AlertRule): { field: string; reason: string }[] {
  const e: { field: string; reason: string }[] = [];
  const q = quoteOf(sym), d = DEF.get(sym)!;
  if (r.type === "price") {
    if (!(r.value > 0)) e.push({ field: "rule.value", reason: "價格必須大於 0" });
    else if (q.limit_up != null && r.value > q.limit_up) e.push({ field: "rule.value", reason: `超出漲停價 ${q.limit_up.toFixed(2)}` });
    else if (q.limit_down != null && r.value < q.limit_down) e.push({ field: "rule.value", reason: `低於跌停價 ${q.limit_down.toFixed(2)}` });
  }
  if (r.type === "change_pct" && (Math.abs(r.value) > 10 || r.value === 0)) e.push({ field: "rule.value", reason: "漲跌幅門檻需在 ±10% 之間且不為 0" });
  if (r.type === "pnl_pct" && !db.holdings.some((h) => h.symbol === sym)) e.push({ field: "rule.type", reason: "沒有持有這個商品，無法建立持倉損益警報" });
  if (r.type === "volume_ratio" && !(r.value >= 1.5)) e.push({ field: "rule.value", reason: "倍數至少 1.5" });
  if (d.kind === "index" && (r.type === "volume_ratio" || r.type === "limit" || r.type === "pnl_pct")) e.push({ field: "rule.type", reason: "指數不支援這種規則" });
  return e;
}

// ── 路由 ──
export function handle(method: string, path: string, query: Record<string, string>, body: any, headers: Record<string, string> = {}): MockResponse {
  const m = (re: RegExp) => path.match(re);
  const key = headers["idempotency-key"];
  if (method === "POST" && key && db.idem.has(method + path + key)) return db.idem.get(method + path + key)!;
  const res = route(method, path, query, body, m);
  if (method === "POST" && key && res.status < 400) db.idem.set(method + path + key, res);
  return res;
}
function route(method: string, path: string, query: Record<string, string>, body: any, m: (re: RegExp) => RegExpMatchArray | null): MockResponse {
  let r: RegExpMatchArray | null;
  if (method === "GET") {
    if (path === "/bootstrap") return ok({
      server_time: MOCK_NOW(), app_version: "1.0.0", market_status: marketStatus(), prefs: db.prefs,
      capabilities: { intraday: true, adjusted_bars: flags.adjusted, corporate_actions: false, max_watch_items: 200, max_watchlists: 10, max_alerts: 100, poll_ms: { open: 5000, closed: 60000 } },
      channels: { push: { vapid_public_key: "BMockVapidPublicKeyOnlyForDevelopment0000000000000000000000000000000000000000000000000" }, telegram: { connected: true } },
    } satisfies Bootstrap);
    if (path === "/overview") {
      nudge();
      const hs = holdings();
      return ok({ as_of: MOCK_NOW(), market_status: marketStatus(), indices: ["TAIEX", "TPEX"].map((s) => ({ symbol: s, name: DEF.get(s)!.name, quote: quoteOf(s), spark: sparkOf(s) })), portfolio: summary(hs), holdings: hs, watchlists: db.watchlists.map(watchOut), unread_alert_events: db.events.filter((e) => !e.read_at).length });
    }
    if (path === "/quotes") {
      nudge();
      const syms = (query.symbols || "").split(",").filter(Boolean).slice(0, 60);
      const quotes = syms.filter((s) => DEF.has(s)).map((s) => ({ ...quoteOf(s), ...(query.spark === "1" ? { spark: sparkOf(s) } : {}) }));
      return ok({ quotes, errors: syms.filter((s) => !DEF.has(s)).map((s) => ({ symbol: s, code: "SYMBOL_UNKNOWN" })), poll_ms: flags.session === "open" || flags.session === "closing_auction" || flags.session === "pre_open" ? 5000 : 60000 });
    }
    if (path === "/instruments/search") {
      const q = (query.q || "").trim().toUpperCase();
      const held = new Set(db.holdings.map((h) => h.symbol)), onw = new Set(db.watchlists.flatMap((w) => w.items.map((i) => i.symbol)));
      const rows = q ? DEFS.filter((d) => d.symbol.includes(q) || d.name.toUpperCase().includes(q)).slice(0, Math.min(20, Number(query.limit) || 20)).map((d) => ({ ...instrumentOf(d.symbol), on_watchlist: onw.has(d.symbol), held: held.has(d.symbol) })) : [];
      return ok({ rows });
    }
    if ((r = m(/^\/instruments\/([^/]+)$/))) {
      const s = decodeURIComponent(r[1]);
      if (!DEF.has(s)) return fail(404, "SYMBOL_UNKNOWN", "找不到這個代號");
      const d = DEF.get(s)!, dl = daily(s).slice(-250);
      return ok({ instrument: instrumentOf(s), quote: quoteOf(s), position: holdings().find((h) => h.symbol === s) ?? null, alerts: db.alerts.filter((a) => a.symbol === s).map(alertOut), watchlist_ids: db.watchlists.filter((w) => w.items.some((i) => i.symbol === s)).map((w) => w.watchlist_id), stats: { avg_volume_5d_lots: d.kind === "index" ? null : avgVol5(s), high_52w: dl.length ? Math.max(...dl.map((b) => b.h)) : null, low_52w: dl.length ? Math.min(...dl.map((b) => b.l)) : null } });
    }
    if ((r = m(/^\/bars\/([^/]+)$/))) {
      const s = decodeURIComponent(r[1]);
      if (!DEF.has(s)) return fail(404, "SYMBOL_UNKNOWN", "找不到這個代號");
      const interval = (query.interval || "1d") as "1d" | "1w" | "1M";
      const limit = Math.min(1000, Number(query.limit) || 300);
      const adjust = flags.adjusted && query.adjust === "forward" ? "forward" : "none";
      let all = adjust === "forward" ? adjustForward(daily(s), s) : daily(s);
      if (interval !== "1d") all = aggregate(all, interval);
      const to = query.to;
      const upto = to ? all.filter((b) => b.t <= to) : all;
      const slice = upto.slice(-limit);
      const earliest = all[0]?.t ?? null;
      const truncated = upto.length < limit;
      if (truncated && !to && query.allow_partial !== "1") return fail(422, "INSUFFICIENT_HISTORY", "K 線資料範圍不足", [{ field: "limit", reason: "可得資料不足", earliest: earliest }]);
      return ok({ symbol: s, interval, adjust, bars: slice, coverage: { requested_from: null, actual_from: slice[0]?.t ?? null, actual_to: slice.at(-1)?.t ?? null, complete: !truncated, truncated, reason: truncated ? "可得資料自 " + earliest + " 起" : null }, has_more_before: upto.length > limit, as_of: MOCK_NOW() });
    }
    if ((r = m(/^\/intraday\/([^/]+)$/))) {
      const s = decodeURIComponent(r[1]);
      if (!DEF.has(s)) return fail(404, "SYMBOL_UNKNOWN", "找不到這個代號");
      const d = DEF.get(s)!, q = quoteOf(s);
      let pts = intradayPoints(s);
      const gaps: { from: string; to: string }[] = [];
      let from = pts[0]?.t ?? null, complete = pts.length > 0, reason: string | null = null;
      if (s === "TS03") { pts = pts.filter((p) => p.t.slice(11, 16) >= "10:42"); from = pts[0]?.t ?? null; complete = false; reason = "新加入追蹤，分時線自 10:42 起"; }
      if (s === "TE01" || s === "TAIEX") { const a = "10:05", b = "10:20"; pts = pts.filter((p) => { const hm = p.t.slice(11, 16); return hm < a || hm >= b; }); gaps.push({ from: `${lastDate()}T${a}:00+08:00`, to: `${lastDate()}T${b}:00+08:00` }); complete = false; reason = "伺服器重啟，10:05–10:20 沒有資料"; }
      if (s === "TS06") { complete = false; reason = "行情來源中斷"; }
      // 半天交易日（?halfday=1）：收盤 12:00，前端軸標籤要跟著伺服器給的時段（F-8）
      const end = flags.halfDay ? "12:00" : "13:30";
      if (flags.halfDay) pts = pts.filter((p) => p.t.slice(11, 16) <= end);
      return ok({ symbol: s, date: lastDate(), prev_close: d.prev || null, limit_up: q.limit_up, limit_down: q.limit_down, session_start: `${lastDate()}T09:00:00+08:00`, session_end: `${lastDate()}T${end}:00+08:00`, points: pts, coverage: { from, complete, reason, gaps }, as_of: MOCK_NOW() });
    }
    if (path === "/portfolio") { const hs = holdings(); return ok({ summary: summary(hs), holdings: hs }); }
    if (path === "/trades") { const rows = db.trades.filter((t) => !query.symbol || t.symbol === query.symbol).sort((a, b) => b.trade_date.localeCompare(a.trade_date)); return ok({ rows, next_cursor: null }); }
    if (path === "/watchlists") return ok({ rows: db.watchlists.map(watchOut) });
    if (path === "/alerts") return ok({ rows: db.alerts.filter((a) => (!query.status || a.status === query.status) && (!query.symbol || a.symbol === query.symbol)).map(alertOut) });
    if (path === "/alert-events") { const rows = db.events.filter((e) => query.unread_only !== "1" || !e.read_at).sort((a, b) => b.fired_at.localeCompare(a.fired_at)); return ok({ rows, next_cursor: null, unread: db.events.filter((e) => !e.read_at).length }); }
    if (path === "/push/devices") return ok({ rows: db.devices });
    if (path === "/prefs") return ok(db.prefs);
    if (path === "/status") return ok({ server_time: MOCK_NOW(), sources: [
      { name: "個股行情（KGI）", ok: true, last_ok_at: MOCK_NOW(), note: "盤中 ≤ 15 秒為即時" },
      { name: "加權指數（TWSE）", ok: true, last_ok_at: MOCK_NOW(), note: "每分鐘一筆" },
      { name: "櫃買指數", ok: !flags.tpexDown, last_ok_at: flags.tpexDown ? null : MOCK_NOW(), note: flags.tpexDown ? "資料來源尚未開通" : "每分鐘一筆" },
      { name: "推播服務", ok: true, last_ok_at: `${TODAY}T10:41:00+08:00`, note: null },
    ] });
    return fail(404, "NOT_FOUND", "找不到資料");
  }

  // ── 寫入 ──
  if (method === "POST" && path === "/alerts/preview") {
    const s = body?.symbol;
    if (!DEF.has(s)) return fail(404, "SYMBOL_UNKNOWN", "找不到這個代號");
    const errors = validateRule(s, body.rule), e = evalRule(s, body.rule);
    return ok({ valid: !errors.length, errors, current: e.current, distance_pct: e.distance_pct, already_met: e.met, hint: e.met ? "目前已滿足條件，不會立刻通知；需先離開條件，再次觸及時才會通知" : null });
  }
  if (method === "POST" && path === "/watchlists") {
    const name = String(body?.name ?? "").trim();
    if (!name || name.length > 20) return fail(422, "VALIDATION_FAILED", "有欄位需要修正", [{ field: "name", reason: "名稱需為 1–20 字" }]);
    if (db.watchlists.length >= 10) return fail(409, "WATCHLIST_LIMIT_REACHED", "清單數量已達上限（10 份）");
    const w: Watchlist = { watchlist_id: "wl_" + ++db.seq, name, position: db.watchlists.length, version: 1, items: [] };
    db.watchlists.push(w); return ok(watchOut(w), 201);
  }
  if ((r = m(/^\/watchlists\/([^/]+)(\/items(?:\/([^/]+))?|\/order)?$/))) {
    const w = db.watchlists.find((x) => x.watchlist_id === decodeURIComponent(r![1]));
    if (!w) return fail(404, "NOT_FOUND", "找不到這份清單");
    const sub = r[2];
    if (!sub && method === "PATCH") {
      if (body.expected_version !== w.version) return fail(409, "VERSION_CONFLICT", "別台裝置已修改，請重新載入後再試");
      if (body.name != null) { const n = String(body.name).trim(); if (!n || n.length > 20) return fail(422, "VALIDATION_FAILED", "有欄位需要修正", [{ field: "name", reason: "名稱需為 1–20 字" }]); w.name = n; }
      if (body.position != null) { const arr = db.watchlists.filter((x) => x !== w); arr.splice(body.position, 0, w); arr.forEach((x, i) => (x.position = i)); db.watchlists = arr; }
      w.version++; return ok(watchOut(w));
    }
    if (!sub && method === "DELETE") {
      if (w.watchlist_id === "wl_default") return fail(422, "VALIDATION_FAILED", "預設清單不可刪除", [{ field: "watchlist_id", reason: "預設清單不可刪除" }]);
      db.watchlists = db.watchlists.filter((x) => x !== w); return ok({ deleted: true });
    }
    if (sub === "/items" && method === "POST") {
      const s = body?.symbol;
      if (!DEF.has(s)) return fail(404, "SYMBOL_UNKNOWN", "找不到這個代號");
      if (!w.items.some((i) => i.symbol === s)) {
        if (db.watchlists.reduce((a, x) => a + x.items.length, 0) >= 200) return fail(409, "WATCHLIST_LIMIT_REACHED", "自選項目已達上限（200 檔）");
        w.items.push({ symbol: s, name: DEF.get(s)!.name, kind: DEF.get(s)!.kind, added_at: MOCK_NOW() } as WatchItem); w.version++;
      }
      return ok(watchOut(w));
    }
    if (r[3] && method === "DELETE") { const s = decodeURIComponent(r[3]); w.items = w.items.filter((i) => i.symbol !== s); w.version++; return ok(watchOut(w)); }
    if (sub === "/order" && method === "PUT") {
      if (body.expected_version !== w.version) return fail(409, "VERSION_CONFLICT", "別台裝置已修改，請重新載入後再試");
      const map = new Map(w.items.map((i) => [i.symbol, i]));
      w.items = (body.symbols as string[]).map((s) => map.get(s)!).filter(Boolean); w.version++; return ok(watchOut(w));
    }
  }
  if (method === "POST" && path === "/alerts") {
    const s = body?.symbol;
    if (!DEF.has(s)) return fail(404, "SYMBOL_UNKNOWN", "找不到這個代號");
    const errs = validateAlert(s, body);
    if (errs.length) return fail(422, "VALIDATION_FAILED", "有欄位需要修正", errs);
    if (db.alerts.length >= 100 || db.alerts.filter((a) => a.symbol === s).length >= 10) return fail(409, "ALERT_LIMIT_REACHED", "警報數量已達上限（總共 100 則，每個商品 10 則）");
    const a = mkAlert("al_" + ++db.seq, s, body.rule, { frequency: body.frequency, cooldown_minutes: body.cooldown_minutes ?? 30, channels: body.channels, note: body.note || null, expires_at: body.expires_at || null, created_at: MOCK_NOW(), updated_at: MOCK_NOW() });
    db.alerts.unshift(a); return ok(alertOut(a), 201);
  }
  if ((r = m(/^\/alerts\/([^/]+)(\/pause|\/resume)?$/))) {
    const a = db.alerts.find((x) => x.alert_id === decodeURIComponent(r![1]));
    if (!a) return fail(404, "NOT_FOUND", "找不到這則警報");
    if (method === "DELETE") { db.alerts = db.alerts.filter((x) => x !== a); return ok({ deleted: true }); }
    if (body?.expected_version !== a.version) return fail(409, "VERSION_CONFLICT", "別台裝置已修改，請重新載入後再試");
    if (r[2] === "/pause") { a.status = "paused"; }
    else if (r[2] === "/resume") { a.status = "active"; a.status_reason = null; }
    else if (method === "PATCH") {
      const merged = { ...a, ...body };
      const errs = validateAlert(a.symbol, merged);
      if (errs.length) return fail(422, "VALIDATION_FAILED", "有欄位需要修正", errs);
      for (const k of ["rule", "frequency", "cooldown_minutes", "channels", "note", "expires_at"] as const) if (k in body) (a as any)[k] = body[k] ?? null;
      if (a.status === "triggered" || a.status === "expired" || a.status === "error") { a.status = "active"; a.status_reason = null; }
    }
    a.version++; a.updated_at = MOCK_NOW(); return ok(alertOut(a));
  }
  if (method === "POST" && path === "/alert-events/read") {
    db.events.forEach((e) => { if (!e.read_at && (body.all || body.ids?.includes(e.event_id))) e.read_at = MOCK_NOW(); });
    return ok({ unread: db.events.filter((e) => !e.read_at).length });
  }
  if (method === "PUT" && path === "/prefs") {
    if (body.version !== db.prefs.version) return fail(409, "VERSION_CONFLICT", "別台裝置已修改，請重新載入後再試");
    db.prefs = { ...db.prefs, ...body, version: db.prefs.version + 1 }; return ok(db.prefs);
  }
  if (method === "POST" && path === "/push/subscriptions") {
    if (!body?.endpoint || !body?.keys?.p256dh) return fail(422, "PUSH_SUBSCRIPTION_INVALID", "訂閱格式不正確");
    db.devices.forEach((d) => (d.is_current = false));
    const d: PushDevice = { device_id: "dev_" + ++db.seq, label: body.device_label || "這台裝置", created_at: MOCK_NOW(), last_ok_at: null, state: "active", is_current: true };
    db.devices.unshift(d); return ok(d, 201);
  }
  if ((r = m(/^\/push\/devices\/([^/]+)$/)) && method === "DELETE") { db.devices = db.devices.filter((d) => d.device_id !== r![1]); return ok({ deleted: true }); }
  if (method === "POST" && path === "/push/test") { const act = db.devices.filter((d) => d.state === "active").length; return ok({ sent: act, failed: db.devices.length - act }); }
  return fail(404, "NOT_FOUND", "找不到資料");
}
function validateAlert(s: string, b: any) {
  const errs = validateRule(s, b.rule);
  if (!["once", "daily", "every"].includes(b.frequency)) errs.push({ field: "frequency", reason: "請選擇頻率" });
  if (b.frequency === "every" && b.cooldown_minutes != null && b.cooldown_minutes < 5) errs.push({ field: "cooldown_minutes", reason: "冷卻時間至少 5 分鐘" });
  if (!Array.isArray(b.channels) || !b.channels.length) errs.push({ field: "channels", reason: "至少選一個通知管道" });
  if (b.note && String(b.note).length > 60) errs.push({ field: "note", reason: "備註最多 60 字" });
  return errs;
}
export const _test = { tradingDays, daily, iso };
