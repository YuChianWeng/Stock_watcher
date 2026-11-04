/**
 * 輪詢（契約 §5）：頁面可見才輪詢；間隔依 market_status；429 依 Retry-After，其他錯誤退避 5→10→20…60s。
 */
import { backoffMs, WatchError } from "./api/client";
import { pollMs, S, emit } from "./state";

export class Poller {
  private timer: number | null = null;
  private fails = 0;
  private stopped = false;
  private onVis = () => { if (document.visibilityState === "visible") this.kick(); else this.clear(); };
  constructor(private fn: () => Promise<void>, private opt: { immediate?: boolean; interval?: () => number } = {}) {
    document.addEventListener("visibilitychange", this.onVis);
    if (opt.immediate) this.kick(); else this.schedule(this.interval());
  }
  private interval() { return this.opt.interval?.() ?? pollMs(); }
  private clear() { if (this.timer != null) clearTimeout(this.timer); this.timer = null; }
  private schedule(ms: number) { this.clear(); if (this.stopped || document.visibilityState === "hidden") return; this.timer = window.setTimeout(() => this.kick(), ms); }
  async kick() {
    this.clear();
    if (this.stopped) return;
    try {
      await this.fn();
      this.fails = 0;
      if (S.upstreamDown) { S.upstreamDown = false; emit("upstream"); }
      this.schedule(this.interval());
    } catch (e) {
      if (e instanceof WatchError && e.code === "UPSTREAM_UNAVAILABLE" && !S.upstreamDown) { S.upstreamDown = true; emit("upstream"); }
      if (e instanceof WatchError && e.code === "UNAUTHENTICATED") { this.schedule(60_000); return; }
      this.schedule(backoffMs(this.fails++, e));
    }
  }
  stop() { this.stopped = true; this.clear(); document.removeEventListener("visibilitychange", this.onVis); }
}
