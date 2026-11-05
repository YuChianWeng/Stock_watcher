import { beforeEach, describe, expect, it } from "vitest";
import { adjustForward, DEFAULT_FLAGS, flags, handle, resetDb } from "../mocks/handlers";

const get = (p: string, q: Record<string, string> = {}) => handle("GET", p, q, undefined) as any;
const post = (p: string, b: unknown, h: Record<string, string> = {}) => handle("POST", p, {}, b, h) as any;

beforeEach(() => { Object.assign(flags, DEFAULT_FLAGS); resetDb(); });

describe("mock contract coverage (§7)", () => {
  it("has every quote status and special prices", () => {
    const q = get("/quotes", { symbols: "TS01,TS02,TS03,TS06,TS07,TS04,TS05,TS08,XXXX" }).body.data;
    const st = Object.fromEntries(q.quotes.map((x: any) => [x.symbol, x]));
    expect(st.TS01.status).toBe("live"); expect(st.TS02.status).toBe("stale"); expect(st.TS03.status).toBe("delayed");
    expect(st.TS06.status).toBe("disconnected"); expect(st.TS07.status).toBe("no_data");
    expect(st.TS04.limit_state).toBe("limit_up"); expect(st.TS05.limit_state).toBe("limit_down");
    expect(st.TS08.direction).toBe("flat");
    expect(q.errors).toEqual([{ symbol: "XXXX", code: "SYMBOL_UNKNOWN" }]);
    flags.session = "closed"; resetDb();
    expect(get("/quotes", { symbols: "TS01" }).body.data.quotes[0].status).toBe("closed");
  });
  it("money fields are decimal strings and summary counts unpriced/stale", () => {
    const o = get("/overview").body.data;
    expect(typeof o.portfolio.market_value).toBe("string");
    expect(o.portfolio.unpriced_count).toBeGreaterThan(0);
    expect(o.portfolio.stale_count).toBeGreaterThan(0);
    expect(o.holdings.find((h: any) => h.symbol === "TE01").qty_shares).toBe(1234);
    expect(o.watchlists.some((w: any) => w.items.length === 0)).toBe(true);
  });
  it("bars: 600 daily, partial last, aggregation, insufficient history", () => {
    const d = get("/bars/TS01", { interval: "1d", limit: "600" }).body.data;
    expect(d.bars.length).toBe(600); expect(d.bars.at(-1).partial).toBe(true); expect(d.bars.at(-1).c).toBe(100.5);
    const w = get("/bars/TS01", { interval: "1w", limit: "100" }).body.data;
    expect(new Date(w.bars[3].t + "T00:00:00Z").getUTCDay()).toBe(1);
    const m = get("/bars/TS01", { interval: "1M", limit: "24" }).body.data;
    expect(m.bars[2].t.endsWith("-01")).toBe(true);
    const e = get("/bars/TS07", { interval: "1d", limit: "300" });
    expect(e.status).toBe(422); expect(e.body.error.code).toBe("INSUFFICIENT_HISTORY");
    const p = get("/bars/TS07", { interval: "1d", limit: "300", allow_partial: "1" }).body.data;
    expect(p.coverage.truncated).toBe(true); expect(p.bars.length).toBe(40);
    expect(get("/bars/TAIEX", { interval: "1d", limit: "10" }).body.data.bars[0].v_lots).toBeNull();
  });
  it("intraday: complete, from 10:42, gap, pre-open empty", () => {
    expect(get("/intraday/TS01").body.data.coverage.complete).toBe(true);
    const t3 = get("/intraday/TS03").body.data; expect(t3.coverage.complete).toBe(false); expect(t3.points[0].t.slice(11, 16)).toBe("10:42");
    expect(get("/intraday/TE01").body.data.coverage.gaps.length).toBe(1);
    flags.session = "pre_open"; resetDb(); expect(get("/intraday/TS01").body.data.points).toEqual([]);
  });
  it("alerts: validation, already_met preview, idempotency", () => {
    const pv = post("/alerts/preview", { symbol: "TS02", rule: { type: "change_pct", op: "lte", value: -5 } }).body.data;
    expect(pv.already_met).toBe(true);
    const bad = post("/alerts", { symbol: "TS01", rule: { type: "price", op: "gte", value: 200 }, frequency: "once", channels: ["push"] });
    expect(bad.status).toBe(422); expect(bad.body.error.details[0].field).toBe("rule.value");
    const noHold = post("/alerts", { symbol: "TS03", rule: { type: "pnl_pct", op: "gte", value: 5 }, frequency: "once", channels: ["push"] });
    expect(noHold.status).toBe(422);
    const body = { symbol: "TS01", rule: { type: "price", op: "gte", value: 104 }, frequency: "once", channels: ["push"] };
    const a = post("/alerts", body, { "idempotency-key": "k1" }), b = post("/alerts", body, { "idempotency-key": "k1" });
    expect(a.body.data.alert_id).toBe(b.body.data.alert_id);
    const statuses = new Set(get("/alerts").body.data.rows.map((x: any) => x.status));
    for (const s of ["active", "paused", "triggered", "expired", "error"]) expect(statuses.has(s)).toBe(true);
    const types = new Set(get("/alerts").body.data.rows.map((x: any) => x.rule.type));
    expect(types.size).toBe(6);
  });
  it("events include late and failed delivery; version conflict on stale write", () => {
    const ev = get("/alert-events").body.data.rows;
    expect(ev.some((e: any) => e.late)).toBe(true);
    expect(ev.some((e: any) => e.deliveries.some((d: any) => d.state === "failed"))).toBe(true);
    const r = handle("PATCH", "/watchlists/wl_default", {}, { expected_version: 99, name: "x" }) as any;
    expect(r.status).toBe(409);
  });
});

describe("還原權息（?adjusted=1，issue #9）", () => {
  it("adjusted_bars 預設 false；開啟旗標後回 true，adjust=forward 的舊 K 線價格較低", () => {
    expect(get("/bootstrap").body.data.capabilities.adjusted_bars).toBe(false);
    const none = get("/bars/TS01", { interval: "1d", limit: "600" }).body.data;
    // 旗標關閉時要求 forward 仍回 none（後端不支援）
    expect(get("/bars/TS01", { interval: "1d", limit: "600", adjust: "forward" }).body.data.adjust).toBe("none");
    flags.adjusted = true;
    expect(get("/bootstrap").body.data.capabilities.adjusted_bars).toBe(true);
    const fwd = get("/bars/TS01", { interval: "1d", limit: "600", adjust: "forward" }).body.data;
    expect(fwd.adjust).toBe("forward");
    expect(fwd.bars.length).toBe(none.bars.length);
    expect(fwd.bars.at(-1).c).toBe(none.bars.at(-1).c); // 最近一根不動
    expect(fwd.bars[0].c).toBeLessThan(none.bars[0].c);  // 除息日之前向下還原
  });
  it("指數不還原", () => {
    flags.adjusted = true;
    const bars = get("/bars/TAIEX", { interval: "1d", limit: "300" }).body.data.bars;
    expect(adjustForward(bars, "TAIEX")).toEqual(bars);
  });
});

describe("半天交易日（?halfday=1，issue #7）", () => {
  it("session_end 為 12:00，點不超過 12:00", () => {
    flags.halfDay = true;
    const d = get("/intraday/TS01").body.data;
    expect(d.session_end.slice(11, 16)).toBe("12:00");
    expect(d.points.every((p: any) => p.t.slice(11, 16) <= "12:00")).toBe(true);
  });
});
