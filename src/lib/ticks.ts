/** 台股升降單位（步進器、漲跌停取整用）。實際驗證由伺服器負責，這裡只用於前端輸入的步進。 */
import type { InstrumentKind } from "../types";

export function tickSize(price: number, kind: InstrumentKind = "stock"): number {
  if (kind === "index") return 0.01;
  if (kind === "etf") return price < 50 ? 0.01 : 0.05;
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** 往上或往下跳 n 檔（跨越級距時依新價位的跳動單位） */
export function stepPrice(price: number, dir: 1 | -1, kind: InstrumentKind = "stock"): number {
  const t = dir > 0 ? tickSize(price, kind) : tickSize(price - 1e-7, kind);
  const snapped = dir > 0 ? Math.floor(r6(price / t)) * t : Math.ceil(r6(price / t)) * t;
  return r6(snapped + dir * t);
}
/** 對齊到最近的有效價位 */
export function snapPrice(price: number, kind: InstrumentKind = "stock"): number {
  const t = tickSize(price, kind);
  return r6(Math.round(r6(price / t)) * t);
}
export const tickDecimals = (t: number) => (t >= 1 ? 0 : t >= 0.1 ? 1 : 2);
