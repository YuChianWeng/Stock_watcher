import { describe, expect, it } from "vitest";
import { parse } from "../src/router";

describe("routes (contract §8)", () => {
  it.each([
    ["/stocks", "overview", {}], ["/stocks/", "overview", {}], ["/stocks/watch", "watch", {}], ["/stocks/holdings", "holdings", {}],
    ["/stocks/s/ts01", "stock", { symbol: "TS01" }], ["/stocks/market", "market", {}], ["/stocks/market/TPEX", "market", { symbol: "TPEX" }],
    ["/stocks/alerts", "alerts", {}], ["/stocks/alerts/new?symbol=TS01", "alert-new", {}], ["/stocks/alerts/al_1", "alert-edit", { id: "al_1" }],
    ["/stocks/inbox", "inbox", {}], ["/stocks/settings", "settings", {}], ["/stocks/settings/notifications", "notifications", {}],
  ])("%s → %s", (u, name, params) => { const r = parse(u); expect(r.name).toBe(name); expect(r.params).toEqual(params); });
  it("keeps query (deep links from push)", () => expect(parse("/stocks/s/TS01?event=ev_5").query.get("event")).toBe("ev_5"));
  it("unknown → notfound", () => expect(parse("/stocks/nope/x").name).toBe("notfound"));
});
