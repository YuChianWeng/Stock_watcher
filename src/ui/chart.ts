/**
 * 圖表（設計稿 §6）：Canvas 繪製分時線與 K 線。
 * - 分時：價格線（缺口斷線，不補線）、昨收、漲跌停、量柱；資料不完整時不畫面積。
 * - K 線：蠟燭（上漲空心、下跌實心、partial 虛線框）、MA、量能副圖、KD／MACD／RSI 副圖。
 * - 疊加：成本線、警報線（虛線＋🔔）、買賣點 B／S。
 * - 互動：滑鼠移動或長按 350ms → 十字游標；拖曳平移、滾輪／雙指縮放、雙擊還原；往左到底載入更早資料；
 *   游標浮層的「在此價位設警報」。容器 touch-action: pan-y，垂直手勢交給頁面捲動。
 */
import type { Bar, IntradayPoint } from "../types";
import { kd, macd, rsi, sma, type Series } from "../lib/indicators";
import { fmtInt, fmtPct, fmtPrice, fmtSigned, fmtTwdShort, hhmm, ymd } from "../lib/fmt";
import { ic } from "./icons";

export type IntradayData = { kind: "intraday"; points: IntradayPoint[]; prevClose: number | null; limitUp: number | null; limitDown: number | null; start: string; end: string; gaps: { from: string; to: string }[]; complete: boolean; isIndex: boolean };
export type KlineData = { kind: "kline"; bars: Bar[]; isIndex: boolean; hasMoreBefore: boolean; interval: "1d" | "1w" | "1M" };
export type ChartData = IntradayData | KlineData;
export type Overlays = { cost: number | null; alerts: number[]; trades: { date: string; side: "buy" | "sell" }[]; showCost: boolean; showAlerts: boolean; showTrades: boolean; mas: number[]; volume: boolean; sub: "none" | "kd" | "macd" | "rsi"; weak: boolean };
export type ChartOpt = { snap?: (p: number) => number; onAlertAt?: (price: number) => void; onNeedMore?: () => Promise<boolean>; onCursor?: (info: string | null) => void };

const AX = 58, BOT = 18, GAP = 8;
const MA_VAR: Record<number, string> = { 5: "--ma5", 10: "--ma10", 20: "--ma20", 60: "--ma60" };
type Pane = { top: number; h: number };

export class Chart {
  private cv: HTMLCanvasElement; private ctx: CanvasRenderingContext2D; private tip: HTMLElement; private act: HTMLElement;
  private data: ChartData | null = null;
  private ov: Overlays = { cost: null, alerts: [], trades: [], showCost: true, showAlerts: true, showTrades: true, mas: [5, 20, 60], volume: true, sub: "none", weak: false };
  private c: Record<string, string> = {};
  private w = 0; private h = 0; private dpr = 1;
  private start = 0; private count = 80; // K 線視窗
  private cursor: number | null = null; private cursorY: number | null = null; private touchCross = false;
  private ind: { ma: Record<number, Series>; k?: Series; d?: Series; dif?: Series; dea?: Series; hist?: Series; rsi?: Series } = { ma: {} };
  private raf = 0; private ro: ResizeObserver; private loadingMore = false; private noMore = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; start: number; moved: boolean; t: number; lp: number | null; pinch?: number; count?: number; dir?: "h" | "v" } | null = null;
  private lastTap = 0; private hideT = 0;
  private panes: { main: Pane; vol: Pane | null; sub: Pane | null } = { main: { top: 0, h: 0 }, vol: null, sub: null };
  private yr = { lo: 0, hi: 1 };

  constructor(private el: HTMLElement, private opt: ChartOpt = {}) {
    el.classList.add("chart");
    el.innerHTML = `<canvas role="img"></canvas><div class="ch-tip" hidden></div><div class="ch-act" hidden><button class="btn sm p" type="button">${ic("bell", "s")}<span></span></button></div><div class="ch-msg" hidden></div>`;
    this.cv = el.querySelector("canvas")!; this.ctx = this.cv.getContext("2d")!;
    this.tip = el.querySelector(".ch-tip")!; this.act = el.querySelector(".ch-act")!;
    this.act.querySelector("button")!.addEventListener("click", (e) => { e.stopPropagation(); const p = this.priceAtY(this.cursorY); if (p != null) this.opt.onAlertAt?.(this.opt.snap ? this.opt.snap(p) : p); });
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(el);
    this.bind(); this.readColors(); this.resize();
  }
  destroy() { this.ro.disconnect(); cancelAnimationFrame(this.raf); this.el.innerHTML = ""; }
  readColors() {
    const cs = getComputedStyle(this.el);
    for (const k of ["--ch-grid", "--ch-axis", "--ch-line", "--ch-fill-top", "--ch-fill-bot", "--ch-prev", "--ch-limit", "--ch-cost", "--ch-alert", "--ma5", "--ma10", "--ma20", "--ma60", "--ind1", "--ind2", "--ind3", "--cross", "--up", "--dn", "--flat", "--up-ink", "--dn-ink", "--mu2", "--s3", "--tx", "--ln2", "--bg", "--ac2", "--wa", "--f-m"]) this.c[k] = cs.getPropertyValue(k).trim();
    this.draw();
  }
  setOverlays(o: Partial<Overlays>) { this.ov = { ...this.ov, ...o }; this.compute(); this.draw(); }
  setData(d: ChartData, keepView = false) {
    const prevLen = this.data?.kind === "kline" ? this.data.bars.length : 0;
    this.data = d; this.noMore = d.kind === "kline" ? !d.hasMoreBefore : true;
    if (d.kind === "kline") {
      if (!keepView || !prevLen) this.resetView();
      else this.start += d.bars.length - prevLen; // 往前載入時維持畫面
    }
    this.cursor = null; this.compute(); this.hideTip(); this.draw(); this.updateAria();
  }
  /** 報價更新最後一點／最後一根 */
  updateLast(price: number, at?: string, volLots?: number | null) {
    const d = this.data; if (!d) return;
    if (d.kind === "kline") {
      const b = d.bars[d.bars.length - 1]; if (!b?.partial) return;
      b.c = price; b.h = Math.max(b.h, price); b.l = Math.min(b.l, price); if (volLots != null && d.interval === "1d") b.v_lots = volLots;
      this.compute();
    } else if (at) {
      const last = d.points[d.points.length - 1];
      const mAt = at.slice(0, 16);
      if (last && last.t.slice(0, 16) === mAt) { last.p = price; if (volLots != null) last.v_lots_cum = volLots; }
      else if (!last || at > last.t) d.points.push({ t: mAt + ":00" + at.slice(19), p: price, v_lots_cum: volLots ?? last?.v_lots_cum ?? null });
    }
    this.draw(); this.updateAria();
  }
  resetView() {
    if (this.data?.kind !== "kline") return;
    this.count = Math.min(this.data.bars.length, this.w < 600 ? 60 : 120);
    this.start = Math.max(0, this.data.bars.length - this.count);
  }
  private compute() {
    const d = this.data; this.ind = { ma: {} };
    if (d?.kind !== "kline") return;
    const cl = d.bars.map((b) => b.c);
    for (const p of [5, 10, 20, 60]) this.ind.ma[p] = sma(cl, p);
    if (this.ov.sub === "kd") { const r = kd(d.bars); this.ind.k = r.k; this.ind.d = r.d; }
    if (this.ov.sub === "macd") { const r = macd(cl); this.ind.dif = r.dif; this.ind.dea = r.dea; this.ind.hist = r.hist; }
    if (this.ov.sub === "rsi") this.ind.rsi = rsi(cl);
  }
  private resize() {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    this.cv.width = Math.round(this.w * this.dpr); this.cv.height = Math.round(this.h * this.dpr);
    this.cv.style.width = this.w + "px"; this.cv.style.height = this.h + "px";
    this.draw();
  }
  private draw() { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.paint()); }

  // ── 座標 ──
  private layout() {
    const H = this.h - BOT, d = this.data;
    const hasVol = this.ov.volume && !!d && (d.kind === "kline" || d.points.some((p) => p.v_lots_cum != null));
    const hasSub = d?.kind === "kline" && this.ov.sub !== "none";
    const volH = hasVol ? Math.round(H * (hasSub ? 0.15 : 0.2)) : 0, subH = hasSub ? Math.round(H * 0.22) : 0;
    const mainH = H - volH - subH - (hasVol ? GAP : 0) - (hasSub ? GAP : 0);
    this.panes = { main: { top: 4, h: mainH - 4 }, vol: hasVol ? { top: mainH + GAP, h: volH } : null, sub: hasSub ? { top: mainH + (hasVol ? GAP + volH : 0) + GAP, h: subH } : null };
  }
  private plotW() { return this.w - AX; }
  private xOf(i: number) { // K 線：第 i 根中心；分時：第 i 分鐘
    const d = this.data!;
    if (d.kind === "kline") return ((i - this.start + 0.5) / this.count) * this.plotW();
    return (i / this.sessionMinutes()) * (this.plotW() - 4) + 2;
  }
  private sessionMinutes() { const d = this.data as IntradayData; return Math.max(1, (Date.parse(d.end) - Date.parse(d.start)) / 60000); }
  private minuteOf(t: string) { const d = this.data as IntradayData; return Math.round((Date.parse(t) - Date.parse(d.start)) / 60000); }
  private yOf(v: number, p = this.panes.main, lo = this.yr.lo, hi = this.yr.hi) { return p.top + (1 - (v - lo) / (hi - lo || 1)) * p.h; }
  private priceAtY(y: number | null) {
    if (y == null) return null; const p = this.panes.main;
    if (y < p.top || y > p.top + p.h) return null;
    return this.yr.hi - ((y - p.top) / p.h) * (this.yr.hi - this.yr.lo);
  }

  // ── 繪製 ──
  private paint() {
    const ctx = this.ctx, c = this.c, d = this.data;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!d) return;
    this.layout();
    ctx.font = `10px ${c["--f-m"] || "monospace"}`;
    if (d.kind === "intraday") this.paintIntraday(d); else this.paintKline(d);
    this.paintCursor();
  }
  private grid(lo: number, hi: number, p: Pane, fmt: (v: number) => string, n = 4) {
    const ctx = this.ctx, c = this.c;
    ctx.strokeStyle = c["--ch-grid"]; ctx.fillStyle = c["--ch-axis"]; ctx.lineWidth = 1; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    for (let i = 0; i <= n; i++) {
      const v = lo + ((hi - lo) * i) / n, y = Math.round(this.yOf(v, p, lo, hi)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.plotW(), y); ctx.stroke();
      ctx.fillText(fmt(v), this.plotW() + 6, Math.min(Math.max(y, p.top + 6), p.top + p.h - 6));
    }
  }
  private hline(v: number, color: string, dash: number[], label: string | null, labelLeft = true) {
    const ctx = this.ctx, p = this.panes.main;
    const inRange = v >= this.yr.lo && v <= this.yr.hi;
    const y = inRange ? Math.round(this.yOf(v)) + 0.5 : v > this.yr.hi ? p.top + 1 : p.top + p.h - 1;
    ctx.save(); ctx.strokeStyle = color; ctx.setLineDash(inRange ? dash : [2, 3]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.plotW(), y); ctx.stroke(); ctx.restore();
    if (label) { ctx.fillStyle = color; ctx.textAlign = labelLeft ? "left" : "right"; ctx.textBaseline = "bottom"; ctx.fillText(label + (inRange ? "" : v > this.yr.hi ? " ↑" : " ↓"), labelLeft ? 4 : this.plotW() - 4, inRange ? y - 3 : v > this.yr.hi ? y + 12 : y - 3); }
  }
  private axisTag(v: number, bg: string, fg: string) {
    const ctx = this.ctx, y = Math.min(Math.max(this.yOf(v), this.panes.main.top + 8), this.panes.main.top + this.panes.main.h - 8);
    ctx.fillStyle = bg; roundRect(ctx, this.plotW() + 2, y - 9, AX - 4, 18, 4); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `600 10.5px ${this.c["--f-m"]}`;
    ctx.fillText(fmtPrice(v), this.plotW() + AX / 2, y + 0.5); ctx.font = `10px ${this.c["--f-m"]}`;
  }
  private range(vals: number[], extra: (number | null)[]) {
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const span0 = hi - lo || Math.abs(hi) * 0.02 || 1;
    for (const e of extra) if (e != null && e > lo - span0 * 0.35 && e < hi + span0 * 0.35) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
    const pad = (hi - lo || span0) * 0.08;
    this.yr = { lo: lo - pad, hi: hi + pad };
  }
  private overlayLines() {
    const c = this.c;
    if (this.ov.showCost && this.ov.cost != null) this.hline(this.ov.cost, c["--ch-cost"], [], `成本 ${fmtPrice(this.ov.cost)}`);
    if (this.ov.showAlerts) for (const a of this.ov.alerts) this.hline(a, c["--ch-alert"], [5, 4], `🔔 ${fmtPrice(a)}`, false);
  }

  private paintIntraday(d: IntradayData) {
    const ctx = this.ctx, c = this.c, pts = d.points, p = this.panes.main;
    const vals = pts.map((x) => x.p);
    if (d.prevClose != null) vals.push(d.prevClose);
    this.range(vals, [d.limitUp, d.limitDown, this.ov.showCost ? this.ov.cost : null, ...(this.ov.showAlerts ? this.ov.alerts : [])].map((v, i) => (i < 2 ? (v != null && Math.abs(v - (d.prevClose ?? v)) / (d.prevClose || 1) < 0.04 ? v : null) : v)));
    this.grid(this.yr.lo, this.yr.hi, p, (v) => fmtPrice(v, d.isIndex && v > 1000 ? 0 : 2));
    // 時間軸
    ctx.fillStyle = c["--ch-axis"]; ctx.textBaseline = "top";
    const total = this.sessionMinutes();
    for (const [lab, m] of [["09:00", 0], ["10:00", 60], ["11:00", 120], ["12:00", 180], ["13:30", total]] as [string, number][]) {
      ctx.textAlign = m === 0 ? "left" : m >= total ? "right" : "center"; ctx.fillText(lab, this.xOf(m), this.h - BOT + 4);
      if (m > 0 && m < total) { ctx.strokeStyle = c["--ch-grid"]; ctx.beginPath(); ctx.moveTo(Math.round(this.xOf(m)) + 0.5, p.top); ctx.lineTo(Math.round(this.xOf(m)) + 0.5, p.top + p.h); ctx.stroke(); }
    }
    if (d.prevClose != null) this.hline(d.prevClose, c["--ch-prev"], [2, 4], `昨收 ${fmtPrice(d.prevClose)}`);
    if (d.limitUp != null && d.limitUp <= this.yr.hi) this.hline(d.limitUp, c["--ch-limit"], [1, 3], `漲停 ${fmtPrice(d.limitUp)}`);
    if (d.limitDown != null && d.limitDown >= this.yr.lo) this.hline(d.limitDown, c["--ch-limit"], [1, 3], `跌停 ${fmtPrice(d.limitDown)}`);
    this.overlayLines();
    if (!pts.length) return;
    // 分段：分鐘不連續或落在 gaps 中就斷線
    const segs: IntradayPoint[][] = []; let cur: IntradayPoint[] = []; let prevM = -10;
    for (const pt of pts) { const m = this.minuteOf(pt.t); if (cur.length && m - prevM > 1) { segs.push(cur); cur = []; } cur.push(pt); prevM = m; }
    if (cur.length) segs.push(cur);
    const lineColor = this.ov.weak ? c["--mu2"] : c["--ch-line"];
    if (d.complete && segs.length === 1 && !this.ov.weak) {
      const g = ctx.createLinearGradient(0, p.top, 0, p.top + p.h); g.addColorStop(0, c["--ch-fill-top"]); g.addColorStop(1, c["--ch-fill-bot"]);
      ctx.beginPath(); segs[0].forEach((pt, i) => { const x = this.xOf(this.minuteOf(pt.t)), y = this.yOf(pt.p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.lineTo(this.xOf(this.minuteOf(segs[0].at(-1)!.t)), p.top + p.h); ctx.lineTo(this.xOf(this.minuteOf(segs[0][0].t)), p.top + p.h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    }
    ctx.save(); ctx.strokeStyle = lineColor; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; if (!this.ov.weak) { ctx.shadowColor = lineColor; ctx.shadowBlur = 6; }
    for (const s of segs) { ctx.beginPath(); s.forEach((pt, i) => { const x = this.xOf(this.minuteOf(pt.t)), y = this.yOf(pt.p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (s.length === 1) ctx.arc(this.xOf(this.minuteOf(s[0].t)), this.yOf(s[0].p), 1.5, 0, 7); ctx.stroke(); }
    ctx.restore();
    // 量柱
    const vp = this.panes.vol;
    if (vp) {
      const vols = pts.map((pt, i) => (pt.v_lots_cum == null ? 0 : Math.max(0, pt.v_lots_cum - (i && pts[i - 1].v_lots_cum != null && this.minuteOf(pt.t) - this.minuteOf(pts[i - 1].t) === 1 ? pts[i - 1].v_lots_cum! : pt.v_lots_cum))));
      // 缺口後第一點的增量未知 → 0
      const mx = Math.max(1, ...vols), bw = Math.max(1, (this.plotW() / total) * 0.7);
      ctx.globalAlpha = this.ov.weak ? 0.3 : 0.6;
      pts.forEach((pt, i) => { if (!vols[i]) return; const hh = (vols[i] / mx) * vp.h; ctx.fillStyle = i && pt.p < pts[i - 1].p ? c["--dn"] : c["--up"]; ctx.fillRect(this.xOf(this.minuteOf(pt.t)) - bw / 2, vp.top + vp.h - hh, bw, hh); });
      ctx.globalAlpha = 1;
      ctx.fillStyle = c["--ch-axis"]; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(fmtInt(mx) + " 張", this.plotW() + 6, vp.top);
    }
    const last = pts[pts.length - 1].p;
    const dir = d.prevClose == null ? "flat" : last > d.prevClose ? "up" : last < d.prevClose ? "dn" : "flat";
    this.axisTag(last, this.ov.weak ? c["--s3"] : dir === "up" ? c["--up"] : dir === "dn" ? c["--dn"] : c["--s3"], this.ov.weak || dir === "flat" ? c["--tx"] : dir === "up" ? c["--up-ink"] : c["--dn-ink"]);
  }

  private visible(): [number, number] {
    const d = this.data as KlineData;
    return [Math.max(0, Math.floor(this.start)), Math.min(d.bars.length, Math.ceil(this.start + this.count))];
  }
  private paintKline(d: KlineData) {
    const ctx = this.ctx, c = this.c, p = this.panes.main, bars = d.bars;
    if (!bars.length) return;
    const [a, b] = this.visible();
    const vis = bars.slice(a, b);
    const mas = this.ov.mas.filter((m) => this.ind.ma[m]);
    const vals = vis.flatMap((x) => [x.h, x.l]);
    for (const m of mas) for (let i = a; i < b; i++) { const v = this.ind.ma[m][i]; if (v != null) vals.push(v); }
    this.range(vals, [this.ov.showCost ? this.ov.cost : null, ...(this.ov.showAlerts ? this.ov.alerts : [])]);
    this.grid(this.yr.lo, this.yr.hi, p, (v) => fmtPrice(v, d.isIndex && v > 1000 ? 0 : 2));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, this.plotW(), this.h); ctx.clip();
    // 時間軸標籤
    ctx.fillStyle = c["--ch-axis"]; ctx.textBaseline = "top"; ctx.textAlign = "center";
    const step = Math.max(1, Math.ceil(this.count / Math.max(2, this.plotW() / 90)));
    const lab = (t: string) => (d.interval === "1M" ? t.slice(0, 7).replace("-", "/") : d.interval === "1w" ? t.slice(2, 7).replace("-", "/") : t.slice(5, 10).replace("-", "/"));
    for (let i = a; i < b; i++) if (i % step === 0) { const x = this.xOf(i); if (x < 18 || x > this.plotW() - 18) continue; ctx.fillText(lab(bars[i].t), x, this.h - BOT + 4); }
    const cw = this.plotW() / this.count, bw = Math.max(1, cw * 0.68);
    const weak = this.ov.weak;
    for (let i = a; i < b; i++) {
      const x = bars[i], up = x.c >= x.o, col = weak ? c["--mu2"] : up ? c["--up"] : c["--dn"];
      const cx = Math.round(this.xOf(i)) + 0.5, yo = this.yOf(x.o), yc = this.yOf(x.c);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, this.yOf(x.h)); ctx.lineTo(cx, Math.min(yo, yc)); ctx.moveTo(cx, Math.max(yo, yc)); ctx.lineTo(cx, this.yOf(x.l)); ctx.stroke();
      const top = Math.min(yo, yc), hh = Math.max(1, Math.abs(yc - yo));
      if (x.partial) ctx.setLineDash([2, 2]);
      if (up && bw > 3) ctx.strokeRect(cx - bw / 2 + 0.5, top + 0.5, bw - 1, hh - 1); else ctx.fillRect(cx - bw / 2, top, bw, hh);
      ctx.setLineDash([]);
    }
    for (const m of mas) { const s = this.ind.ma[m]; ctx.strokeStyle = c[MA_VAR[m]] || c["--tx"]; ctx.lineWidth = 1.2; ctx.beginPath(); let pen = false; for (let i = Math.max(0, a - 1); i < Math.min(bars.length, b + 1); i++) { const v = s[i]; if (v == null) { pen = false; continue; } const X = this.xOf(i), Y = this.yOf(v); pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true; } ctx.stroke(); }
    // 買賣點
    if (this.ov.showTrades && this.ov.trades.length) {
      const idx = (date: string) => { let lo = 0, hi = bars.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t <= date) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
      for (const t of this.ov.trades) {
        const i = idx(t.date); if (i < a || i >= b) continue;
        const x = this.xOf(i), y = t.side === "buy" ? this.yOf(bars[i].l) + 13 : this.yOf(bars[i].h) - 13;
        ctx.fillStyle = t.side === "buy" ? c["--ac2"] : c["--wa"]; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill();
        ctx.fillStyle = c["--bg"]; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `800 9.5px ${c["--f-m"]}`; ctx.fillText(t.side === "buy" ? "B" : "S", x, y + 0.5); ctx.font = `10px ${c["--f-m"]}`;
      }
    }
    ctx.restore();
    this.overlayLines();
    // 量能
    const vp = this.panes.vol;
    if (vp) {
      const vv = (x: Bar) => (d.isIndex ? x.turnover_twd : x.v_lots) ?? 0;
      const mx = Math.max(1, ...vis.map(vv));
      ctx.save(); ctx.beginPath(); ctx.rect(0, vp.top, this.plotW(), vp.h); ctx.clip(); ctx.globalAlpha = weak ? 0.3 : 0.55;
      for (let i = a; i < b; i++) { const x = bars[i], hh = (vv(x) / mx) * vp.h; ctx.fillStyle = x.c >= x.o ? c["--up"] : c["--dn"]; ctx.fillRect(this.xOf(i) - bw / 2, vp.top + vp.h - hh, bw, hh); }
      ctx.restore();
      ctx.fillStyle = c["--ch-axis"]; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(d.isIndex ? fmtTwdShort(mx) : fmtInt(mx) + " 張", this.plotW() + 6, vp.top);
    }
    // 副圖
    const sp = this.panes.sub;
    if (sp) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, sp.top, this.w, sp.h); ctx.clip();
      const line = (s: Series | undefined, col: string, lo: number, hi: number) => { if (!s) return; ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); let pen = false; for (let i = Math.max(0, a - 1); i < Math.min(bars.length, b + 1); i++) { const v = s[i]; if (v == null) { pen = false; continue; } const X = this.xOf(i), Y = this.yOf(v, sp, lo, hi); pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true; } ctx.stroke(); };
      const guides = (vs: number[], lo: number, hi: number) => { ctx.strokeStyle = c["--ch-grid"]; ctx.setLineDash([3, 3]); ctx.fillStyle = c["--ch-axis"]; ctx.textAlign = "left"; ctx.textBaseline = "middle"; for (const v of vs) { const y = Math.round(this.yOf(v, sp, lo, hi)) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.plotW(), y); ctx.stroke(); ctx.fillText(String(v), this.plotW() + 6, y); } ctx.setLineDash([]); };
      if (this.ov.sub === "kd") { guides([20, 80], 0, 100); line(this.ind.k, c["--ind1"], 0, 100); line(this.ind.d, c["--ind2"], 0, 100); }
      if (this.ov.sub === "rsi") { guides([30, 70], 0, 100); line(this.ind.rsi, c["--ind3"], 0, 100); }
      if (this.ov.sub === "macd") {
        const vs: number[] = []; for (let i = a; i < b; i++) for (const s of [this.ind.dif, this.ind.dea, this.ind.hist]) { const v = s?.[i]; if (v != null) vs.push(v); }
        const m = Math.max(1e-6, ...vs.map(Math.abs)); guides([0], -m, m);
        for (let i = a; i < b; i++) { const v = this.ind.hist?.[i]; if (v == null) continue; const y0 = this.yOf(0, sp, -m, m), y1 = this.yOf(v, sp, -m, m); ctx.fillStyle = v >= 0 ? c["--up"] : c["--dn"]; ctx.globalAlpha = 0.6; ctx.fillRect(this.xOf(i) - bw / 4, Math.min(y0, y1), Math.max(1, bw / 2), Math.abs(y1 - y0)); ctx.globalAlpha = 1; }
        line(this.ind.dif, c["--ind1"], -m, m); line(this.ind.dea, c["--ind2"], -m, m);
      }
      ctx.restore();
    }
    const lb = bars[bars.length - 1], pb = bars[bars.length - 2];
    if (b === bars.length) { const up = !pb || lb.c >= pb.c; this.axisTag(lb.c, weak ? c["--s3"] : up ? c["--up"] : c["--dn"], weak ? c["--tx"] : up ? c["--up-ink"] : c["--dn-ink"]); }
  }

  private paintCursor() {
    if (this.cursor == null || !this.data) return;
    const ctx = this.ctx, c = this.c, x = Math.round(this.cursorX()) + 0.5;
    ctx.save(); ctx.strokeStyle = c["--cross"]; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.h - BOT); ctx.stroke();
    if (this.cursorY != null && this.priceAtY(this.cursorY) != null) { const y = Math.round(this.cursorY) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.plotW(), y); ctx.stroke(); }
    ctx.restore();
    const p = this.priceAtY(this.cursorY);
    if (p != null) { ctx.fillStyle = c["--s3"]; roundRect(ctx, this.plotW() + 2, this.cursorY! - 9, AX - 4, 18, 4); ctx.fill(); ctx.strokeStyle = c["--ln2"]; ctx.stroke(); ctx.fillStyle = c["--tx"]; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(fmtPrice(p), this.plotW() + AX / 2, this.cursorY! + 0.5); }
    if (this.data.kind === "intraday") { const pt = this.data.points[this.cursor]; if (pt) { ctx.fillStyle = c["--ch-line"]; ctx.beginPath(); ctx.arc(this.cursorX(), this.yOf(pt.p), 4, 0, 7); ctx.fill(); ctx.strokeStyle = c["--bg"]; ctx.lineWidth = 2; ctx.stroke(); } }
  }
  private cursorX() { const d = this.data!; return d.kind === "kline" ? this.xOf(this.cursor!) : this.xOf(this.minuteOf(d.points[this.cursor!].t)); }

  // ── 浮層 ──
  private showTip() {
    const d = this.data; if (!d || this.cursor == null) return this.hideTip();
    const r = (k: string, v: string, cls = "") => `<div class="r"><span>${k}</span><span class="${cls}">${v}</span></div>`;
    let html = "";
    if (d.kind === "intraday") {
      const pt = d.points[this.cursor], pc = d.prevClose;
      const ch = pc != null ? pt.p - pc : null, cls = ch == null ? "" : ch > 0 ? "chg up" : ch < 0 ? "chg dn" : "chg flat";
      html = r("時間", hhmm(pt.t)) + r("價格", fmtPrice(pt.p), cls + " no-glyph") + (ch != null ? r("漲跌", `${fmtSigned(ch)} ${fmtPct((ch / pc!) * 100)}`, cls) : "") + (pt.v_lots_cum != null ? r("累計量", fmtInt(pt.v_lots_cum) + " 張") : "");
    } else {
      const b = d.bars[this.cursor], pb = d.bars[this.cursor - 1];
      const ch = pb ? b.c - pb.c : null, cls = ch == null ? "" : ch > 0 ? "chg up" : ch < 0 ? "chg dn" : "chg flat";
      html = r(d.interval === "1d" ? "日期" : d.interval === "1w" ? "週" : "月", (d.interval === "1M" ? b.t.slice(0, 7).replace("-", "/") : ymd(b.t)) + (b.partial ? " ·未完" : "")) + r("開", fmtPrice(b.o)) + r("高", fmtPrice(b.h)) + r("低", fmtPrice(b.l)) + r("收", fmtPrice(b.c), cls + " no-glyph")
        + (ch != null ? r("漲跌", `${fmtSigned(ch)} ${fmtPct((ch / pb.c) * 100)}`, cls) : "")
        + (d.isIndex ? r("金額", fmtTwdShort(b.turnover_twd)) : r("量", fmtInt(b.v_lots) + " 張"))
        + this.ov.mas.map((m) => { const v = this.ind.ma[m]?.[this.cursor!]; return v == null ? "" : r("MA" + m, fmtPrice(v)); }).join("")
        + (this.ov.sub === "kd" && this.ind.k?.[this.cursor] != null ? r("K／D", `${this.ind.k[this.cursor]!.toFixed(1)}／${this.ind.d![this.cursor]!.toFixed(1)}`) : "")
        + (this.ov.sub === "rsi" && this.ind.rsi?.[this.cursor] != null ? r("RSI14", this.ind.rsi[this.cursor]!.toFixed(1)) : "")
        + (this.ov.sub === "macd" && this.ind.dif?.[this.cursor] != null ? r("DIF／DEA", `${this.ind.dif[this.cursor]!.toFixed(2)}／${this.ind.dea![this.cursor]!.toFixed(2)}`) : "");
    }
    this.tip.innerHTML = html; this.tip.hidden = false;
    const x = this.cursorX(), right = x < this.plotW() / 2;
    this.tip.style.left = right ? "auto" : "6px"; this.tip.style.right = right ? AX + 6 + "px" : "auto";
    const p = this.priceAtY(this.cursorY);
    if (this.opt.onAlertAt && p != null && !(this.data?.isIndex)) {
      this.act.hidden = false; this.act.querySelector("span")!.textContent = `在 ${fmtPrice(this.opt.snap ? this.opt.snap(p) : p)} 設警報`;
      const y = Math.min(Math.max(this.cursorY! - 18, 4), this.panes.main.top + this.panes.main.h - 40);
      this.act.style.top = y + "px"; this.act.style.left = right ? "8px" : "auto"; this.act.style.right = right ? "auto" : AX + 8 + "px";
    } else this.act.hidden = true;
    this.opt.onCursor?.(html);
  }
  private hideTip() { this.tip.hidden = true; this.act.hidden = true; this.opt.onCursor?.(null); }
  private setCursorAt(x: number, y: number) {
    const d = this.data; if (!d) return;
    if (d.kind === "kline") { const i = Math.floor(this.start + (x / this.plotW()) * this.count); this.cursor = Math.max(0, Math.min(d.bars.length - 1, i)); }
    else {
      if (!d.points.length) return;
      const m = (x - 2) / (this.plotW() - 4) * this.sessionMinutes();
      let best = 0, bd = Infinity; d.points.forEach((pt, i) => { const dd = Math.abs(this.minuteOf(pt.t) - m); if (dd < bd) { bd = dd; best = i; } });
      this.cursor = best;
    }
    this.cursorY = y; this.showTip(); this.draw();
  }
  private clearCursor() { this.cursor = null; this.cursorY = null; this.hideTip(); this.draw(); }

  // ── 互動 ──
  private bind() {
    const el = this.el;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    el.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest(".ch-act")) return;
      const { x, y } = local(e);
      this.pointers.set(e.pointerId, { x, y });
      clearTimeout(this.hideT);
      if (this.pointers.size === 2 && this.data?.kind === "kline") {
        const [p1, p2] = [...this.pointers.values()];
        this.drag = { x: (p1.x + p2.x) / 2, start: this.start, moved: true, t: Date.now(), lp: null, pinch: Math.abs(p1.x - p2.x), count: this.count };
        if (this.drag.lp) clearTimeout(this.drag.lp);
        return;
      }
      const lp = e.pointerType === "mouse" ? null : window.setTimeout(() => { this.touchCross = true; navigator.vibrate?.(8); this.setCursorAt(x, y); }, 350);
      this.drag = { x, start: this.start, moved: false, t: Date.now(), lp };
      if (e.pointerType !== "mouse") { /* 讓垂直捲動保留給頁面 */ } else el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      const { x, y } = local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
      const dr = this.drag;
      if (dr?.pinch && this.pointers.size === 2 && this.data?.kind === "kline") {
        const [p1, p2] = [...this.pointers.values()]; const dist = Math.max(10, Math.abs(p1.x - p2.x));
        this.zoomAround(dr.x, (dr.count! * dr.pinch) / dist, dr); return;
      }
      if (this.touchCross || (e.pointerType === "mouse" && !dr)) { if (this.data) this.setCursorAt(x, y); e.preventDefault(); return; }
      if (!dr) return;
      const dx = x - dr.x;
      if (!dr.moved && Math.abs(dx) > 6) { dr.moved = true; dr.dir = "h"; if (dr.lp) clearTimeout(dr.lp); if (e.pointerType !== "mouse") try { el.setPointerCapture(e.pointerId); } catch { /* */ } }
      if (dr.moved && this.data?.kind === "kline") { this.start = dr.start - (dx / this.plotW()) * this.count; this.clampView(); this.clearCursor(); this.maybeLoadMore(); }
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      const dr = this.drag;
      if (dr?.lp) clearTimeout(dr.lp);
      if (this.pointers.size) return;
      this.drag = null;
      if (this.touchCross) { this.touchCross = false; this.hideT = window.setTimeout(() => this.clearCursor(), 2600); return; }
      if (dr && !dr.moved && Date.now() - dr.t < 250) {
        const now = Date.now();
        if (now - this.lastTap < 300) { this.resetView(); this.clearCursor(); this.draw(); this.lastTap = 0; }
        else { this.lastTap = now; if (e.pointerType !== "mouse" && this.cursor != null) this.clearCursor(); }
      }
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", (e) => { this.pointers.delete(e.pointerId); if (this.drag?.lp) clearTimeout(this.drag.lp); this.drag = null; this.touchCross = false; });
    el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !this.drag) this.clearCursor(); });
    el.addEventListener("dblclick", () => { this.resetView(); this.clearCursor(); });
    el.addEventListener("wheel", (e) => {
      if (this.data?.kind !== "kline" || !(e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX))) return;
      e.preventDefault();
      const { x } = local(e);
      this.zoomAround(x, this.count * (e.deltaY > 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // 長按時禁止頁面捲動
    el.addEventListener("touchmove", (e) => { if (this.touchCross || this.drag?.moved || this.pointers.size > 1) e.preventDefault(); }, { passive: false });
    el.tabIndex = 0;
    el.addEventListener("keydown", (e) => {
      if (this.data?.kind !== "kline") return;
      if (e.key === "ArrowLeft") { this.start -= Math.max(1, this.count / 10); this.clampView(); this.maybeLoadMore(); this.draw(); }
      else if (e.key === "ArrowRight") { this.start += Math.max(1, this.count / 10); this.clampView(); this.draw(); }
      else if (e.key === "+" || e.key === "=") this.zoomAround(this.plotW(), this.count / 1.25);
      else if (e.key === "-") this.zoomAround(this.plotW(), this.count * 1.25);
      else return;
      e.preventDefault();
    });
  }
  private zoomAround(x: number, newCount: number, dr?: { start: number; count?: number }) {
    const d = this.data as KlineData;
    const baseStart = dr?.start ?? this.start, baseCount = dr?.count ?? this.count;
    const nc = Math.max(20, Math.min(300, Math.min(d.bars.length, newCount)));
    const anchor = baseStart + (x / this.plotW()) * baseCount;
    this.count = nc; this.start = anchor - (x / this.plotW()) * nc;
    this.clampView(); this.clearCursor(); this.maybeLoadMore();
  }
  private clampView() {
    const d = this.data as KlineData; const n = d.bars.length;
    this.count = Math.min(this.count, Math.max(1, n));
    this.start = Math.max(0, Math.min(n - this.count, this.start));
    this.draw();
  }
  private async maybeLoadMore() {
    if (this.loadingMore || this.noMore || this.start > 3 || !this.opt.onNeedMore) return;
    this.loadingMore = true; this.msg("載入更早的資料…");
    try { const more = await this.opt.onNeedMore(); if (!more) { this.noMore = true; this.msg("已是最早資料", 1800); } else this.msg(null); }
    catch { this.msg("載入失敗，再往左拖一次重試", 2200); }
    finally { this.loadingMore = false; }
  }
  private msg(t: string | null, ms = 0) {
    const m = this.el.querySelector(".ch-msg") as HTMLElement; m.hidden = !t; if (t) m.textContent = t;
    if (ms) setTimeout(() => { if (m.textContent === t) m.hidden = true; }, ms);
  }
  private updateAria() {
    const d = this.data; if (!d) return;
    let s = "";
    if (d.kind === "intraday") {
      const ps = d.points.map((p) => p.p);
      s = ps.length ? `分時線：現價 ${fmtPrice(ps.at(-1)!)}${d.prevClose != null ? `，昨收 ${fmtPrice(d.prevClose)}` : ""}，區間高 ${fmtPrice(Math.max(...ps))} 低 ${fmtPrice(Math.min(...ps))}` : "分時線：尚無資料";
    } else if (d.bars.length) {
      const [a, b] = this.visible(); const v = d.bars.slice(a, b);
      s = `${{ "1d": "日", "1w": "週", "1M": "月" }[d.interval]} K 線：${ymd(v[0].t)} 至 ${ymd(v.at(-1)!.t)}，最後收盤 ${fmtPrice(v.at(-1)!.c)}，區間高 ${fmtPrice(Math.max(...v.map((x) => x.h)))} 低 ${fmtPrice(Math.min(...v.map((x) => x.l)))}`;
    }
    this.cv.setAttribute("aria-label", s);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
