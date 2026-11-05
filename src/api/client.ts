/**
 * HTTP 核心（契約 §1、§5、§6.3）：回應信封、錯誤碼、冪等 key、登入過期偵測、429／503 退避。
 */
import type { ApiError, ErrorCode } from "../types";

export const API_BASE = "/api/watch";
export type ClientCode = ErrorCode | "OFFLINE" | "NETWORK" | "BAD_RESPONSE" | "FORBIDDEN";

export class WatchError extends Error {
  code: ClientCode; status: number; details: NonNullable<ApiError["details"]>; retryAfter: number | null;
  constructor(code: ClientCode, message: string, status = 0, details: ApiError["details"] = [], retryAfter: number | null = null) {
    super(message); this.code = code; this.status = status; this.details = details ?? []; this.retryAfter = retryAfter;
  }
  /** 依欄位整理錯誤（422 VALIDATION_FAILED） */
  fieldErrors(): Record<string, string> {
    const o: Record<string, string> = {};
    for (const d of this.details) if (d.field) o[d.field] = d.reason ?? "格式不正確";
    return o;
  }
}

export const ERROR_TEXT: Record<ClientCode, string> = {
  UNAUTHENTICATED: "登入已過期",
  VALIDATION_FAILED: "有欄位需要修正",
  NOT_FOUND: "找不到資料",
  SYMBOL_UNKNOWN: "找不到這個代號",
  VERSION_CONFLICT: "別台裝置已修改，請重新載入後再試",
  ALERT_LIMIT_REACHED: "警報數量已達上限",
  WATCHLIST_LIMIT_REACHED: "自選數量已達上限",
  INSUFFICIENT_HISTORY: "K 線資料範圍不足",
  RATE_LIMITED: "請求太頻繁，稍後再試",
  UPSTREAM_UNAVAILABLE: "行情來源暫時無法使用",
  PUSH_SUBSCRIPTION_INVALID: "推播訂閱格式不正確，請重新訂閱",
  OFFLINE: "目前離線",
  NETWORK: "連線失敗",
  BAD_RESPONSE: "伺服器回應格式不正確",
  FORBIDDEN: "沒有權限存取",
};

export type Query = Record<string, string | number | boolean | null | undefined>;
export function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "") p.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  const s = p.toString();
  return s ? "?" + s : "";
}

type ClientEvent = { type: "auth-expired" } | { type: "ok" } | { type: "net-fail" };
const listeners = new Set<(e: ClientEvent) => void>();
export const onClientEvent = (f: (e: ClientEvent) => void) => { listeners.add(f); return () => listeners.delete(f); };
const emit = (e: ClientEvent) => listeners.forEach((f) => f(e));

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

export type ReqOpt = { query?: Query; body?: unknown; signal?: AbortSignal; idempotencyKey?: string };

export async function request<T>(method: string, path: string, opt: ReqOpt = {}): Promise<T> {
  const write = method !== "GET";
  if (write && typeof navigator !== "undefined" && navigator.onLine === false) throw new WatchError("OFFLINE", ERROR_TEXT.OFFLINE);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opt.body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST") headers["Idempotency-Key"] = opt.idempotencyKey ?? newIdempotencyKey();
  let res: Response;
  try {
    res = await fetch(API_BASE + path + qs(opt.query), {
      method, credentials: "same-origin", headers, signal: opt.signal,
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
      redirect: "manual",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    emit({ type: "net-fail" });
    const off = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new WatchError(off ? "OFFLINE" : "NETWORK", ERROR_TEXT[off ? "OFFLINE" : "NETWORK"]);
  }
  // §6.3：401、被導向 Access 登入頁（opaqueredirect／redirected／拿到 HTML）一律視為登入過期
  const ctype = res.headers.get("Content-Type") || "";
  const html = ctype.includes("text/html");
  const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
  if (res.status === 401 || res.type === "opaqueredirect" || res.redirected || (html && (res.ok || res.status === 403)) || res.url.includes("/cdn-cgi/access/login")) {
    emit({ type: "auth-expired" });
    throw new WatchError("UNAUTHENTICATED", ERROR_TEXT.UNAUTHENTICATED, 401);
  }
  let json: unknown = undefined;
  if (!html) { try { json = await res.json(); } catch { json = undefined; } }
  const err = isObj(json) && isObj(json.error) && typeof json.error.code === "string" ? (json.error as unknown as ApiError) : null;
  if (err) {
    if (err.code === "UNAUTHENTICATED") emit({ type: "auth-expired" });
    const code = (err.code in ERROR_TEXT ? err.code : statusCode(res.status)) as ClientCode;
    throw new WatchError(code, (typeof err.message === "string" && err.message) || ERROR_TEXT[code], res.status, Array.isArray(err.details) ? err.details : [], retryAfter);
  }
  // 不是契約信封：反向代理／隧道的錯誤頁等，依狀態碼分類
  if (!res.ok) { const code = statusCode(res.status); throw new WatchError(code, ERROR_TEXT[code], res.status, [], retryAfter); }
  if (!isObj(json) || !("data" in json)) throw new WatchError("BAD_RESPONSE", ERROR_TEXT.BAD_RESPONSE, res.status);
  emit({ type: "ok" });
  return json.data as T;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 非信封錯誤回應的狀態碼分類：502／503／504／52x／530 視為行情來源中斷 */
export function statusCode(status: number): ClientCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530)) return "UPSTREAM_UNAVAILABLE";
  return "BAD_RESPONSE";
}

/** Retry-After：秒數或 HTTP 日期 */
export function parseRetryAfter(v: string | null, now = Date.now()): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0 ? n : null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t > now ? Math.ceil((t - now) / 1000) : null;
}

/** §5 退避：5s、10s、20s … 上限 60s；429 依 Retry-After */
export function backoffMs(attempt: number, err?: unknown): number {
  if (err instanceof WatchError && (err.code === "RATE_LIMITED" || err.code === "UPSTREAM_UNAVAILABLE") && err.retryAfter) return Math.min(300_000, err.retryAfter * 1000);
  return Math.min(60_000, 5000 * 2 ** Math.max(0, attempt));
}

export const loginUrl = () => `/cdn-cgi/access/login?redirect_url=${encodeURIComponent(location.href)}`;
