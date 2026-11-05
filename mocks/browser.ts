/**
 * 在瀏覽器內攔截 fetch('/api/watch/*')，交給 handlers.ts 回應（開發與單檔預覽用，不需要 service worker）。
 * 情境（契約 §7 必須涵蓋）：設定頁的「開發用 Mock」面板，或網址加 ?mock=<情境>&session=<時段>&push=<權限>
 */
import { handle, fail, flags, resetDb, DEFAULT_FLAGS, type MockFlags, type MockResponse, type MockSession } from "./handlers";

export type Scenario = "none" | "slow" | "auth" | "validation" | "version" | "rate" | "down" | "proxy502" | "offline";
export const SCENARIOS: [Scenario, string][] = [
  ["none", "正常"], ["slow", "延遲 1.5 秒（骨架）"], ["auth", "登入過期（401）"], ["validation", "下一次寫入 422"],
  ["version", "下一次修改 409"], ["rate", "下一次讀取 429"], ["down", "行情 503（來源中斷）"], ["proxy502", "隧道回 HTML 502"], ["offline", "離線"],
];
export const SESSIONS: [MockSession, string][] = [["open", "盤中"], ["pre_open", "盤前"], ["closing_auction", "收盤撮合"], ["post", "盤後"], ["closed", "休市"]];
export type PushMock = "auto" | "unsupported" | "not_installed" | "default" | "granted" | "revoked" | "denied";
export const PUSH_STATES: PushMock[] = ["auto", "unsupported", "not_installed", "default", "granted", "revoked", "denied"];

const KEY = "sw-mock";
export const URL_KEYS = ["mock", "session", "push", "empty", "extreme", "nodevices", "adjusted", "halfday"];
type Saved = { scenario: Scenario; flags: MockFlags; push: PushMock };
let scenario: Scenario = "none";
let push: PushMock = "granted";
let fakeOffline = false;

function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ scenario, flags, push } satisfies Saved)); } catch { /* ignore */ } }
function load(): Partial<Saved> { try { return JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return {}; } }

export const mock = {
  get scenario() { return scenario; },
  get flags() { return flags; },
  get push() { return push; },
  setScenario(s: Scenario) {
    scenario = s;
    const was = fakeOffline; fakeOffline = s === "offline";
    if (was !== fakeOffline) window.dispatchEvent(new Event(fakeOffline ? "offline" : "online"));
    save();
  },
  setFlags(f: Partial<MockFlags>) { const reset = "empty" in f || "extreme" in f || "noDevices" in f; Object.assign(flags, f); if (reset) resetDb(); else resetDb(); save(); },
  setPush(p: PushMock) { push = p; save(); },
};
(globalThis as any).__mock = mock;

const once = () => { scenario = "none"; save(); };
const json = (r: MockResponse) => new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json; charset=utf-8", ...(r.headers ?? {}) } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let downUntil = 0;

export function installMock() {
  const u = new URLSearchParams(location.search);
  // 網址上有任何 mock 參數 → 完全依網址（沒寫的回到預設）；沒有 → 沿用同分頁上次在面板選的狀態
  const fromUrl = URL_KEYS.some((k) => u.has(k));
  const saved: Partial<Saved> = fromUrl ? {} : load();
  Object.assign(flags, DEFAULT_FLAGS, saved.flags ?? {});
  if (u.get("session")) flags.session = u.get("session") as MockSession;
  if (u.has("empty")) flags.empty = u.get("empty") === "1";
  if (u.has("extreme")) flags.extreme = u.get("extreme") === "1";
  if (u.has("nodevices")) flags.noDevices = u.get("nodevices") === "1";
  if (u.has("adjusted")) flags.adjusted = u.get("adjusted") === "1";
  if (u.has("halfday")) flags.halfDay = u.get("halfday") === "1";
  push = (u.get("push") as PushMock) || saved.push || "granted";
  resetDb();
  mock.setScenario((u.get("mock") as Scenario) || saved.scenario || "none");

  const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  try { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => (fakeOffline ? false : desc?.get?.call(navigator) ?? true) }); } catch { /* ignore */ }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (!url.pathname.startsWith("/api/watch")) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.slice("/api/watch".length) || "/";
    const query = Object.fromEntries(url.searchParams.entries());
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    let body: unknown;
    if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    const write = method !== "GET";

    await sleep(scenario === "slow" ? 1500 : 60 + Math.random() * 90);
    if (fakeOffline) throw new TypeError("Failed to fetch (mock offline)");
    if (scenario === "auth") return json(fail(401, "UNAUTHENTICATED", "登入已過期"));
    if (scenario === "rate" && !write) { once(); return json(fail(429, "RATE_LIMITED", "請求太頻繁", [], { "Retry-After": "3" })); }
    if (scenario === "down" && !write && /^\/(quotes|overview|intraday|bars)/.test(path)) { downUntil = Date.now() + 1; return json(fail(503, "UPSTREAM_UNAVAILABLE", "行情來源暫時無法使用")); }
    if (scenario === "validation" && write && path !== "/alerts/preview") { once(); return json(fail(422, "VALIDATION_FAILED", "有欄位需要修正", [{ field: "rule.value", reason: "（模擬）超出漲停價" }, { field: "note", reason: "（模擬）備註含有不支援的字元" }, { field: "name", reason: "（模擬）名稱重複" }])); }
    if (scenario === "version" && (method === "PATCH" || method === "PUT" || /\/(pause|resume)$/.test(path))) { once(); return json(fail(409, "VERSION_CONFLICT", "別台裝置已修改，請重新載入後再試")); }
    if (scenario === "proxy502" && !write && /^\/(quotes|overview|intraday|bars)/.test(path)) return new Response("<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><p>(mock) tunnel origin unreachable</p></body></html>", { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } });
    void downUntil;
    return json(handle(method, path, query, body, headers));
  };
}
