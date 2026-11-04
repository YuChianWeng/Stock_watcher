/**
 * 虛構 K 線與分時線產生器（契約 §7：固定種子的隨機漫步，不得複製任何真實價格序列）。
 * 價格對齊台股升降單位；最後一根收盤＝指定的現價。
 */
import type { Bar, InstrumentKind, IntradayPoint } from "../src/types";
import { snapPrice } from "../src/lib/ticks";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
export function seedOf(sym: string) { let h = 2166136261; for (const c of sym) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** 從 end 往回數 n 個交易日（週一到週五；不考慮國定假日，mock 用） */
export function tradingDays(end: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(end + "T00:00:00Z");
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

export type GenOpt = { symbol: string; kind: InstrumentKind; last: number; days: number; end: string; baseLots: number; partial: boolean };

export function genDaily(o: GenOpt): Bar[] {
  const r = rng(seedOf(o.symbol));
  const dates = tradingDays(o.end, o.days);
  // 先倒著走：從現價往回推，確保最後一根收盤 = last
  const closes: number[] = new Array(o.days);
  closes[o.days - 1] = o.last;
  const vol = o.kind === "etf" ? 0.009 : o.kind === "index" ? 0.008 : 0.019;
  for (let i = o.days - 2; i >= 0; i--) {
    const drift = Math.sin(i / 37 + seedOf(o.symbol) % 7) * 0.0012;
    closes[i] = Math.max(o.last * 0.25, closes[i + 1] / (1 + (r() - 0.5) * 2 * vol + drift));
  }
  const snap = (v: number) => (o.kind === "index" ? Math.round(v * 100) / 100 : snapPrice(v, o.kind));
  const bars: Bar[] = [];
  for (let i = 0; i < o.days; i++) {
    const c = snap(closes[i]);
    const prev = i ? bars[i - 1].c : c * (1 + (r() - 0.5) * vol);
    const op = snap(prev * (1 + (r() - 0.5) * vol * 0.6));
    const h = snap(Math.max(op, c) * (1 + r() * vol * 0.6));
    const l = snap(Math.min(op, c) * (1 - r() * vol * 0.6));
    const lots = Math.round(o.baseLots * (0.45 + r() * 1.3) * (1 + Math.abs(c - prev) / prev * 18));
    bars.push({
      t: dates[i], o: op, h: Math.max(h, op, c), l: Math.min(l, op, c), c,
      v_lots: o.kind === "index" ? null : lots,
      turnover_twd: o.kind === "index" ? Math.round((2000 + r() * 900) * 1e8) : Math.round(lots * 1000 * c),
    });
  }
  if (o.partial) bars[bars.length - 1].partial = true;
  return bars;
}

/** 週 K（週一起算）、月 K（1 日起算）由日 K 合成（SPEC §7） */
export function aggregate(daily: Bar[], interval: "1w" | "1M"): Bar[] {
  const key = (t: string) => {
    if (interval === "1M") return t.slice(0, 8) + "01";
    const d = new Date(t + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10);
  };
  const out: Bar[] = [];
  for (const b of daily) {
    const k = key(b.t), cur = out[out.length - 1];
    if (cur && cur.t === k) {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c;
      cur.v_lots = cur.v_lots == null || b.v_lots == null ? null : cur.v_lots + b.v_lots;
      cur.turnover_twd = cur.turnover_twd == null || b.turnover_twd == null ? null : cur.turnover_twd + b.turnover_twd;
      if (b.partial) cur.partial = true;
    } else out.push({ ...b, t: k });
  }
  return out;
}

/** 分時線：09:00 起每分鐘一點，到 upto（分鐘數，0 = 09:00）為止；結束價 = last */
export function genIntraday(symbol: string, date: string, prev: number, last: number, upto: number, kind: InstrumentKind, baseLots: number): IntradayPoint[] {
  const r = rng(seedOf(symbol) ^ 0x9e37);
  const n = upto + 1;
  const p: number[] = new Array(n);
  p[n - 1] = last;
  const vol = kind === "index" ? 0.0006 : 0.0032;
  for (let i = n - 2; i >= 0; i--) p[i] = p[i + 1] / (1 + (r() - 0.5) * 2 * vol);
  // 讓第一點接近昨收附近
  const k0 = (prev * (1 + (r() - 0.5) * 0.006)) - p[0];
  for (let i = 0; i < n; i++) p[i] += k0 * (1 - i / (n - 1 || 1));
  p[n - 1] = last;
  let cum = 0;
  return p.map((v, i) => {
    const hh = 9 + Math.floor(i / 60), mm = i % 60;
    cum += Math.round((baseLots / 270) * (0.3 + r() * 1.4) * (i < 15 || i > 260 ? 2.4 : 1));
    return {
      t: `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`,
      p: kind === "index" ? Math.round(v * 100) / 100 : snapPrice(v, kind),
      v_lots_cum: kind === "index" ? null : cum,
    };
  });
}
