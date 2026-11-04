/** 技術指標（契約：由前端用 K 線資料計算，S-3）。輸入收盤價或 OHLC，輸出與輸入等長的陣列（不足期數為 null）。 */
import type { Bar } from "../types";

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

/** MACD(12,26,9)：DIF、DEA（訊號線）、柱狀 = (DIF − DEA) × 2（台灣券商慣例） */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const dif = closes.map((_, i) => ef[i] - es[i]);
  const dea = ema(dif, signal);
  const hist = dif.map((v, i) => (v - dea[i]) * 2);
  const warm = (a: number[]): Series => a.map((v, i) => (i < slow - 1 ? null : v));
  return { dif: warm(dif), dea: warm(dea), hist: warm(hist) };
}

/** RSI（Wilder 平滑） */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** KD(9,3,3)：RSV → K = 2/3 K' + 1/3 RSV，D = 2/3 D' + 1/3 K；起始 50 */
export function kd(bars: Pick<Bar, "h" | "l" | "c">[], n = 9) {
  const K: Series = [], D: Series = [];
  let k = 50, d = 50;
  for (let i = 0; i < bars.length; i++) {
    if (i < n - 1) { K.push(null); D.push(null); continue; }
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
    const rsv = hi === lo ? 50 : ((bars[i].c - lo) / (hi - lo)) * 100;
    k = (2 / 3) * k + rsv / 3;
    d = (2 / 3) * d + k / 3;
    K.push(k); D.push(d);
  }
  return { k: K, d: D };
}
