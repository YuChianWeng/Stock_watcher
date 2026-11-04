/**
 * 數字、金額、時間格式。
 * - 行情價格是 number（§0 F-4），顯示時固定位數。
 * - 金額是十進位字串，用 BigInt 處理，不轉 float。
 * - 時間一律 Asia/Taipei。
 */
import type { Direction, Decimal } from "../types";

export const MINUS = "−"; // U+2212，和 ▲▼ 一起使用

export function priceDecimals(p: number | null | undefined): number {
  if (p == null) return 2;
  return Math.abs(p) >= 1000 && Number.isInteger(p) ? 0 : 2;
}
const nf = (d: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = new Map<number, Intl.NumberFormat>();
function num(v: number, d: number) { let f = NF.get(d); if (!f) NF.set(d, (f = nf(d))); return f.format(v); }

/** 價格：100.50、10,000.00；null → — */
export const fmtPrice = (v: number | null | undefined, d = 2) => (v == null ? "—" : num(v, d));
/** 有號數：+2.50、−1.60、0.00 */
export function fmtSigned(v: number | null | undefined, d = 2): string {
  if (v == null) return "—";
  const s = num(Math.abs(v), d);
  if (s === num(0, d)) return s;
  return (v > 0 ? "+" : MINUS) + s;
}
export const fmtPct = (v: number | null | undefined, d = 2) => (v == null ? "—" : fmtSigned(v, d) + "%");
export const fmtInt = (v: number | null | undefined) => (v == null ? "—" : num(Math.round(v), 0));

/** 成交量（張） */
export const fmtLots = (v: number | null | undefined) => (v == null ? "—" : num(v, 0) + " 張");

/** 股數 → 「3 張」「1 張 234 股」「234 股」（§0 F-5） */
export function fmtShares(shares: number): string {
  const lots = Math.floor(shares / 1000), odd = shares % 1000;
  if (lots && odd) return `${num(lots, 0)} 張 ${odd} 股`;
  if (lots) return `${num(lots, 0)} 張`;
  return `${odd} 股`;
}

/** 成交金額：1.2 億、3,456 萬 */
export function fmtTwdShort(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e8) return num(v / 1e8, a >= 1e11 ? 0 : 1) + " 億";
  if (a >= 1e4) return num(v / 1e4, 0) + " 萬";
  return num(v, 0);
}

// ── 十進位字串 ──
const DEC_RE = /^(-)?(\d+)(?:\.(\d+))?$/;
/** 解析成 BigInt（單位：10^-scale） */
export function decToBig(s: Decimal, scale = 2): bigint {
  const m = DEC_RE.exec(s.trim());
  if (!m) throw new Error("bad decimal: " + s);
  const frac = (m[3] ?? "").padEnd(scale, "0");
  // 四捨五入多出的位數
  let v = BigInt(m[2] + frac.slice(0, scale));
  if (frac.length > scale && Number(frac[scale]) >= 5) v += 1n;
  return m[1] && v !== 0n ? -v : v;
}
export function decSign(s: Decimal | null | undefined): -1 | 0 | 1 {
  if (s == null) return 0;
  const v = decToBig(s);
  return v > 0n ? 1 : v < 0n ? -1 : 0;
}
export const decDir = (s: Decimal | null | undefined): Direction => (decSign(s) > 0 ? "up" : decSign(s) < 0 ? "down" : "flat");
/** 金額字串顯示：分位、小數位（預設 0，四捨五入）、可選正負號 */
export function fmtMoney(s: Decimal | null | undefined, opt: { decimals?: number; signed?: boolean; prefix?: string } = {}): string {
  if (s == null) return "—";
  const d = opt.decimals ?? 0;
  const v = decToBig(s, d);
  const neg = v < 0n, abs = neg ? -v : v;
  const str = abs.toString().padStart(d + 1, "0");
  const ip = str.slice(0, str.length - d) || "0", fp = d ? "." + str.slice(-d) : "";
  const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = neg ? MINUS : opt.signed && abs !== 0n ? "+" : "";
  return sign + (opt.prefix ?? "") + grouped + fp;
}

// ── 時間（Asia/Taipei） ──
const TZ = "Asia/Taipei";
const parts = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date(iso));
  const o: Record<string, string> = {};
  p.forEach((x) => (o[x.type] = x.value));
  if (o.hour === "24") o.hour = "00";
  return o;
};
export const hhmm = (iso: string | null | undefined) => (iso ? (({ hour, minute }) => `${hour}:${minute}`)(parts(iso)) : "—");
export const hhmmss = (iso: string | null | undefined) => (iso ? (({ hour, minute, second }) => `${hour}:${minute}:${second}`)(parts(iso)) : "—");
export const mmdd = (iso: string | null | undefined) => (iso ? (({ month, day }) => `${month}/${day}`)(parts(iso.length === 10 ? iso + "T12:00:00+08:00" : iso)) : "—");
export const ymd = (iso: string | null | undefined) => (iso ? (({ year, month, day }) => `${year}/${month}/${day}`)(parts(iso.length === 10 ? iso + "T12:00:00+08:00" : iso)) : "—");
const WD: Record<string, string> = { Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日" };
export const weekday = (iso: string) => WD[parts(iso).weekday] ?? "";
/** 同一天只顯示時間，否則顯示日期＋時間 */
export function when(iso: string | null | undefined, now: string): string {
  if (!iso) return "—";
  const a = parts(iso), b = parts(now);
  if (a.year === b.year && a.month === b.month && a.day === b.day) return `${a.hour}:${a.minute}`;
  return `${a.month}/${a.day} ${a.hour}:${a.minute}`;
}
/** 台北日期 YYYY-MM-DD */
export const taipeiDate = (iso: string) => (({ year, month, day }) => `${year}-${month}-${day}`)(parts(iso));
