/// <reference types="node" />
/** public/sw.js（契約 §6.2、§6.4）與 scripts/sw-build.mjs（issue #3） */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
// @ts-expect-error 純 JS 建置腳本
import { buildIdOf, listFiles, renderSw, writeSw } from "../scripts/sw-build.mjs";

const SRC = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

/** 在 vm 裡執行 sw.js，回傳事件處理器與假的 self／caches */
function loadSw(src = SRC, cacheNames: string[] = []) {
  const handlers: Record<string, (e: any) => void> = {};
  const shown: { title: string; opts: any }[] = [];
  const posted: any[] = [];
  const opened: string[] = [];
  const caches = new Map<string, Map<string, unknown>>(cacheNames.map((n) => [n, new Map()]));
  const windows: any[] = [];
  const self = {
    addEventListener: (t: string, f: (e: any) => void) => (handlers[t] = f),
    registration: { showNotification: vi.fn(async (title: string, opts: any) => { shown.push({ title, opts }); }) },
    clients: {
      matchAll: async () => windows,
      openWindow: async (u: string) => { opened.push(u); },
      claim: async () => {},
    },
    skipWaiting: vi.fn(),
  };
  const cacheApi = {
    open: async (n: string) => { if (!caches.has(n)) caches.set(n, new Map()); const c = caches.get(n)!; return { addAll: async (fs: string[]) => fs.forEach((f) => c.set(f, 1)), put: async (k: string, v: unknown) => c.set(String(k), v), match: async (k: string) => c.get(String(k)) }; },
    keys: async () => [...caches.keys()],
    delete: async (n: string) => caches.delete(n),
  };
  runInNewContext(src, { self, caches: cacheApi, location: { origin: "https://x.test" }, URL, fetch: async () => { throw new Error("offline"); }, console });
  const fire = async (type: string, e: any) => { let p: Promise<unknown> = Promise.resolve(); handlers[type]({ ...e, waitUntil: (x: Promise<unknown>) => (p = x) }); await p; };
  return { handlers, shown, posted, opened, caches, windows, fire, self };
}

describe("sw.js push：一定要 showNotification", () => {
  const cases: [string, any][] = [
    ["正常 payload", { json: () => ({ title: "TS01 到價", body: "現價 101", tag: "a1", url: "/stocks/s/TS01" }) }],
    ["沒有 data", null],
    ["JSON 壞掉", { json: () => { throw new SyntaxError("bad"); } }],
    ["欄位型別錯誤", { json: () => ({ title: 1, body: { x: 1 }, url: "https://evil.test/" }) }],
    ["null payload", { json: () => null }],
  ];
  it.each(cases)("%s", async (_n, data) => {
    const sw = loadSw();
    await sw.fire("push", { data });
    expect(sw.shown).toHaveLength(1);
    expect(typeof sw.shown[0].title).toBe("string");
    expect(sw.shown[0].title.length).toBeGreaterThan(0);
    expect(sw.shown[0].opts.data.url.startsWith("/stocks/")).toBe(true);
  });
  it("通知會帶到指定頁面；外部網址不接受", async () => {
    const a = loadSw(); await a.fire("push", { data: { json: () => ({ title: "t", url: "/stocks/s/TS01" }) } });
    expect(a.shown[0].opts.data.url).toBe("/stocks/s/TS01");
    const b = loadSw(); await b.fire("push", { data: { json: () => ({ title: "t", url: "https://evil.test/" }) } });
    expect(b.shown[0].opts.data.url).toBe("/stocks/inbox");
  });
});

describe("sw.js notificationclick", () => {
  it("App 開著 → focus＋postMessage；沒開 → openWindow", async () => {
    const sw = loadSw();
    const win = { url: "https://x.test/stocks/", focus: vi.fn(async () => {}), postMessage: vi.fn() };
    sw.windows.push(win);
    await sw.fire("notificationclick", { notification: { close() {}, data: { url: "/stocks/s/TS02" } } });
    expect(win.focus).toHaveBeenCalled(); expect(win.postMessage).toHaveBeenCalledWith({ type: "navigate", url: "/stocks/s/TS02" });
    const sw2 = loadSw();
    await sw2.fire("notificationclick", { notification: { close() {}, data: { url: "/stocks/s/TS02" } } });
    expect(sw2.opened).toEqual(["/stocks/s/TS02"]);
  });
});

describe("sw-build：build id 與快取清理", () => {
  function fakeDist(appCode: string) {
    const d = mkdtempSync(join(tmpdir(), "swb-"));
    mkdirSync(join(d, "assets"));
    writeFileSync(join(d, "index.html"), "<html></html>");
    writeFileSync(join(d, "assets", "app.js"), appCode);
    writeFileSync(join(d, "sw.js"), SRC);
    return d;
  }
  it("內容不同 → sw.js 位元組不同；內容相同 → 相同", () => {
    const a = fakeDist("console.log(1)"), b = fakeDist("console.log(2)"), c = fakeDist("console.log(1)");
    try {
      writeSw(a); writeSw(b); writeSw(c);
      const [sa, sb, sc] = [a, b, c].map((d) => readFileSync(join(d, "sw.js"), "utf8"));
      expect(sa).not.toBe(sb); expect(sa).toBe(sc);
      expect(sa).not.toContain("__BUILD_ID__");
      expect(sa).toContain('"assets/app.js"');
      expect(sa).not.toMatch(/"sw\.js"/);
    } finally { [a, b, c].forEach((d) => rmSync(d, { recursive: true })); }
  });
  it("placeholder 不見時建置失敗（避免靜默產生固定版本）", () => {
    expect(() => renderSw("const BUILD_ID = 'x';", "id", [])).toThrow();
  });
  it("listFiles／buildIdOf", () => {
    const d = fakeDist("x");
    try { expect(listFiles(d)).toEqual(["assets/app.js", "index.html", "sw.js"]); expect(buildIdOf(d, ["assets/app.js"])).toMatch(/^[0-9a-f]{12}$/); }
    finally { rmSync(d, { recursive: true }); }
  });
  it("activate 只留目前版本的快取；install 預先快取 shell 檔案", async () => {
    const src = renderSw(SRC, "new123", ["assets/app-abc.js", "assets/font.woff2"]);
    const sw = loadSw(src, ["stocks-old999-shell", "stocks-v1-shell", "other-app-cache"]);
    await sw.fire("install", {});
    await sw.fire("activate", {});
    expect([...sw.caches.keys()].sort()).toEqual(["other-app-cache", "stocks-new123-shell"]);
    expect([...sw.caches.get("stocks-new123-shell")!.keys()]).toEqual(["/stocks/", "/stocks/assets/app-abc.js", "/stocks/assets/font.woff2"]);
  });
});
