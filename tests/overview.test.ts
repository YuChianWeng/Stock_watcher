import { describe, expect, it } from "vitest";
import { sortHoldings } from "../src/views/overview";
import type { Holding } from "../src/types";

const h = (symbol: string, pnl: string | null, mv: string | null, pct: number | null) => ({ symbol, unrealized_pnl: pnl, market_value: mv, quote: { change_pct: pct } } as unknown as Holding);
describe("holding sort uses decimal strings, not floats", () => {
  const hs = [h("TS02", "-21000.00", "119000.00", -6.3), h("TS01", "31115.00", "301500.00", 2.55), h("TS07", null, null, null), h("TE01", "1168.10", "185038.00", 0.3)];
  it("by pnl", () => expect(sortHoldings(hs, "pnl").map((x) => x.symbol)).toEqual(["TS01", "TE01", "TS02", "TS07"]));
  it("by market value", () => expect(sortHoldings(hs, "mv").map((x) => x.symbol)).toEqual(["TS01", "TE01", "TS02", "TS07"]));
  it("by change", () => expect(sortHoldings(hs, "chg")[0].symbol).toBe("TS01"));
  it("by symbol", () => expect(sortHoldings(hs, "sym")[0].symbol).toBe("TE01"));
});
