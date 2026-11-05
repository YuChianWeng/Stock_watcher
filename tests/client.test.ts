/** src/api/client.ts：信封、錯誤分類（issue #4）、登入過期偵測、退避 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { backoffMs, onClientEvent, parseRetryAfter, request, statusCode, WatchError } from "../src/api/client";

type R = { status?: number; type?: string; body?: string; headers?: Record<string, string>; url?: string; redirected?: boolean };
function stub(r: R) {
  const res = new Response(r.body ?? null, { status: r.status ?? 200, headers: r.headers });
  Object.defineProperty(res, "url", { value: r.url ?? "https://example.test/api/watch/quotes" });
  if (r.redirected) Object.defineProperty(res, "redirected", { value: true });
  if (r.type) Object.defineProperty(res, "type", { value: r.type });
  vi.stubGlobal("fetch", vi.fn(async () => res));
}
const html = (status: number) => ({ status, body: `<!DOCTYPE html><html><body>${status}</body></html>`, headers: { "Content-Type": "text/html; charset=utf-8" } });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
async function codeOf(r: R) {
  stub(r);
  try { await request("GET", "/quotes"); return "OK"; } catch (e) { expect(e).toBeInstanceOf(WatchError); return (e as WatchError).code; }
}

afterEach(() => vi.unstubAllGlobals());

describe("request() 錯誤分類", () => {
  it.each([
    ["502 HTML（隧道）", html(502), "UPSTREAM_UNAVAILABLE"],
    ["503 HTML", html(503), "UPSTREAM_UNAVAILABLE"],
    ["504 HTML", html(504), "UPSTREAM_UNAVAILABLE"],
    ["522 HTML", html(522), "UPSTREAM_UNAVAILABLE"],
    ["530 HTML（Cloudflare）", html(530), "UPSTREAM_UNAVAILABLE"],
    ["403 HTML（Access 拒絕）", html(403), "UNAUTHENTICATED"],
    ["403 JSON 非信封", json(403, { error: "forbidden" }), "FORBIDDEN"],
    ["500 純文字", { status: 500, body: "oops", headers: { "Content-Type": "text/plain" } }, "BAD_RESPONSE"],
    ["429 非信封", { status: 429, body: "", headers: { "Retry-After": "7" } }, "RATE_LIMITED"],
    ["200 body null", json(200, null), "BAD_RESPONSE"],
    ["200 body 陣列", json(200, [1, 2]), "BAD_RESPONSE"],
    ["200 沒有 data", json(200, { ok: true }), "BAD_RESPONSE"],
    ["200 非 JSON", { status: 200, body: "{not json", headers: { "Content-Type": "application/json" } }, "BAD_RESPONSE"],
    ["503 JSON 信封", json(503, { error: { code: "UPSTREAM_UNAVAILABLE", message: "行情來源暫時無法使用" } }), "UPSTREAM_UNAVAILABLE"],
    ["200 HTML（Access 登入頁）", html(200), "UNAUTHENTICATED"],
    ["401", json(401, { error: { code: "UNAUTHENTICATED", message: "x" } }), "UNAUTHENTICATED"],
    ["被導向登入頁", { ...json(200, {}), redirected: true }, "UNAUTHENTICATED"],
    ["opaqueredirect", { status: 200, type: "opaqueredirect" }, "UNAUTHENTICATED"],
    ["422 信封", json(422, { error: { code: "VALIDATION_FAILED", message: "x", details: [{ field: "rule.value", reason: "太大" }] } }), "VALIDATION_FAILED"],
    ["信封 error 不是物件", json(500, { error: "boom" }), "BAD_RESPONSE"],
  ])("%s → %s", async (_n, r, code) => { expect(await codeOf(r as R)).toBe(code); });

  it("200 信封回傳 data", async () => {
    stub(json(200, { data: { a: 1 } }));
    await expect(request("GET", "/x")).resolves.toEqual({ a: 1 });
  });

  it("502 HTML 會讀 Retry-After；422 的欄位錯誤可取出", async () => {
    stub({ ...html(502), headers: { "Content-Type": "text/html", "Retry-After": "12" } });
    const e = (await request("GET", "/quotes").catch((x) => x)) as WatchError;
    expect(e.code).toBe("UPSTREAM_UNAVAILABLE"); expect(e.retryAfter).toBe(12); expect(e.status).toBe(502);
    stub(json(422, { error: { code: "VALIDATION_FAILED", message: "x", details: [{ field: "note", reason: "太長" }] } }));
    const v = (await request("POST", "/alerts", { body: {} }).catch((x) => x)) as WatchError;
    expect(v.fieldErrors()).toEqual({ note: "太長" });
  });

  it("登入過期會發出 auth-expired；成功發出 ok；網路失敗發出 net-fail", async () => {
    const seen: string[] = []; const off = onClientEvent((e) => seen.push(e.type));
    stub(html(200)); await request("GET", "/x").catch(() => {});
    stub(json(200, { data: 1 })); await request("GET", "/x");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const e = (await request("GET", "/x").catch((x) => x)) as WatchError;
    expect(e.code).toBe("NETWORK");
    off();
    expect(seen).toEqual(["auth-expired", "ok", "net-fail"]);
  });

  it("POST 帶 Idempotency-Key（可指定）", async () => {
    stub(json(200, { data: 1 }));
    await request("POST", "/alerts", { body: { a: 1 }, idempotencyKey: "k-1" });
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
    expect(init.redirect).toBe("manual");
  });
});

describe("statusCode／parseRetryAfter／backoffMs", () => {
  it("狀態碼分類", () => {
    expect([502, 503, 504, 520, 524, 530].map(statusCode)).toEqual(Array(6).fill("UPSTREAM_UNAVAILABLE"));
    expect(statusCode(500)).toBe("BAD_RESPONSE"); expect(statusCode(531)).toBe("BAD_RESPONSE");
    expect(statusCode(404)).toBe("NOT_FOUND"); expect(statusCode(429)).toBe("RATE_LIMITED");
  });
  it("Retry-After：秒數與 HTTP 日期", () => {
    expect(parseRetryAfter("5")).toBe(5); expect(parseRetryAfter("0")).toBeNull(); expect(parseRetryAfter(null)).toBeNull();
    const now = Date.parse("2026-11-05T00:00:00Z");
    expect(parseRetryAfter("Thu, 05 Nov 2026 00:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("garbage", now)).toBeNull();
  });
  it("退避 5→10→20→40→60 上限；429／503 依 Retry-After", () => {
    expect([0, 1, 2, 3, 4, 9].map((a) => backoffMs(a))).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
    expect(backoffMs(0, new WatchError("RATE_LIMITED", "", 429, [], 3))).toBe(3000);
    expect(backoffMs(0, new WatchError("UPSTREAM_UNAVAILABLE", "", 502, [], 30))).toBe(30000);
    expect(backoffMs(2, new WatchError("UPSTREAM_UNAVAILABLE", "", 502))).toBe(20000);
  });
});
