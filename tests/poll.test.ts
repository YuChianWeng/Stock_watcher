/** src/poll.ts：可見才輪詢、間隔、退避、來源中斷狀態（issue #4、#9） */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doc = { visibilityState: "visible" as "visible" | "hidden", l: new Set<() => void>(),
  addEventListener(_: string, f: () => void) { this.l.add(f); }, removeEventListener(_: string, f: () => void) { this.l.delete(f); },
  set(v: "visible" | "hidden") { this.visibilityState = v; this.l.forEach((f) => f()); } };
vi.stubGlobal("document", doc);
vi.stubGlobal("window", globalThis);

const { Poller } = await import("../src/poll");
const { S, sub } = await import("../src/state");
const { WatchError } = await import("../src/api/client");

let p: InstanceType<typeof Poller> | null = null;
beforeEach(() => { vi.useFakeTimers(); doc.visibilityState = "visible"; S.upstreamDown = false; S.boot = null; });
afterEach(() => { p?.stop(); p = null; vi.useRealTimers(); });

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("Poller", () => {
  it("依 interval 重複呼叫", async () => {
    const fn = vi.fn(async () => {});
    p = new Poller(fn, { immediate: true, interval: () => 1000 });
    await flush(); expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000); expect(fn).toHaveBeenCalledTimes(5);
  });

  it("頁面隱藏就停、回到前景立即補一次", async () => {
    const fn = vi.fn(async () => {});
    p = new Poller(fn, { immediate: true, interval: () => 1000 });
    await flush(); doc.set("hidden");
    await vi.advanceTimersByTimeAsync(10_000); expect(fn).toHaveBeenCalledTimes(1);
    doc.set("visible"); await flush(); expect(fn).toHaveBeenCalledTimes(2);
  });

  it("UPSTREAM_UNAVAILABLE（含 HTML 502 分類後）→ 來源中斷，退避 5s→10s，恢復後解除", async () => {
    const seen: boolean[] = []; const off = sub("upstream", () => seen.push(S.upstreamDown));
    let fail = 2;
    const fn = vi.fn(async () => { if (fail-- > 0) throw new WatchError("UPSTREAM_UNAVAILABLE", "x", 502); });
    p = new Poller(fn, { immediate: true, interval: () => 1000 });
    await flush(); expect(S.upstreamDown).toBe(true);
    await vi.advanceTimersByTimeAsync(4999); expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000); expect(fn).toHaveBeenCalledTimes(3);
    expect(S.upstreamDown).toBe(false);
    expect(seen).toEqual([true, false]); off();
  });

  it("429 依 Retry-After", async () => {
    let n = 0;
    const fn = vi.fn(async () => { if (n++ === 0) throw new WatchError("RATE_LIMITED", "x", 429, [], 3); });
    p = new Poller(fn, { immediate: true, interval: () => 60_000 });
    await flush(); await vi.advanceTimersByTimeAsync(2999); expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fn).toHaveBeenCalledTimes(2);
  });

  it("登入過期改為每 60 秒；stop() 後不再呼叫", async () => {
    const fn = vi.fn(async () => { throw new WatchError("UNAUTHENTICATED", "x", 401); });
    p = new Poller(fn, { immediate: true, interval: () => 1000 });
    await flush(); await vi.advanceTimersByTimeAsync(59_999); expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fn).toHaveBeenCalledTimes(2);
    p.stop(); await vi.advanceTimersByTimeAsync(120_000); expect(fn).toHaveBeenCalledTimes(2);
  });

  it("預設間隔依 market_status 與 poll_ms", async () => {
    S.boot = { market_status: { session: "open" }, capabilities: { poll_ms: { open: 2000, closed: 30000 } } } as any;
    const fn = vi.fn(async () => {});
    p = new Poller(fn, { immediate: true });
    await flush(); await vi.advanceTimersByTimeAsync(2000); expect(fn).toHaveBeenCalledTimes(2);
  });
});
