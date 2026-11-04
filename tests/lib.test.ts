import { describe, expect, it } from "vitest";
import { decSign, decToBig, fmtMoney, fmtPct, fmtPrice, fmtShares, fmtSigned, fmtTwdShort, hhmm, mmdd } from "../src/lib/fmt";
import { snapPrice, stepPrice, tickSize } from "../src/lib/ticks";
import { kd, macd, rsi, sma } from "../src/lib/indicators";

describe("fmt", () => {
  it("formats prices and signs with U+2212", () => {
    expect(fmtPrice(10000)).toBe("10,000.00");
    expect(fmtSigned(2.5)).toBe("+2.50");
    expect(fmtSigned(-1.6)).toBe("−1.60");
    expect(fmtSigned(0)).toBe("0.00");
    expect(fmtPct(-6.3)).toBe("−6.30%");
    expect(fmtPrice(null)).toBe("—");
  });
  it("shows odd lots (F-5)", () => {
    expect(fmtShares(3000)).toBe("3 張");
    expect(fmtShares(1234)).toBe("1 張 234 股");
    expect(fmtShares(234)).toBe("234 股");
  });
  it("handles decimal strings without float", () => {
    expect(decToBig("123456.78")).toBe(12345678n);
    expect(decToBig("-0.005")).toBe(-1n);
    expect(fmtMoney("123456789.49")).toBe("123,456,789");
    expect(fmtMoney("-21000.00", { signed: true })).toBe("−21,000");
    expect(fmtMoney("31500.5", { signed: true, decimals: 2 })).toBe("+31,500.50");
    expect(fmtMoney("0.00", { signed: true })).toBe("0");
    expect(decSign("-0.01")).toBe(-1);
    expect(decSign("0.00")).toBe(0);
  });
  it("abbreviates turnover", () => {
    expect(fmtTwdShort(3_210_000_000)).toBe("32.1 億");
    expect(fmtTwdShort(56_000_000)).toBe("5,600 萬");
  });
  it("uses Asia/Taipei", () => {
    expect(hhmm("2026-11-04T02:41:05Z")).toBe("10:41");
    expect(mmdd("2026-11-04")).toBe("11/04");
  });
});

describe("ticks", () => {
  it("follows TWSE tick rules", () => {
    expect(tickSize(9.99)).toBe(0.01); expect(tickSize(23.8)).toBe(0.05); expect(tickSize(55)).toBe(0.1);
    expect(tickSize(100.5)).toBe(0.5); expect(tickSize(512)).toBe(1); expect(tickSize(1235)).toBe(5);
    expect(tickSize(22.35, "etf")).toBe(0.01); expect(tickSize(150, "etf")).toBe(0.05);
  });
  it("steps across bands", () => {
    expect(stepPrice(100.5, 1)).toBe(101); expect(stepPrice(100, -1)).toBe(99.9); expect(stepPrice(99.9, 1)).toBe(100);
    expect(stepPrice(23.8, -1)).toBe(23.75); expect(snapPrice(100.3)).toBe(100.5);
  });
});

describe("indicators", () => {
  const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 5 + i * 0.1);
  it("sma", () => { const s = sma([1, 2, 3, 4], 2); expect(s).toEqual([null, 1.5, 2.5, 3.5]); });
  it("rsi is within 0..100 and 100 on monotonic rise", () => {
    expect(rsi(c).filter((v) => v != null).every((v) => v! >= 0 && v! <= 100)).toBe(true);
    expect(rsi(Array.from({ length: 20 }, (_, i) => i + 1)).at(-1)).toBe(100);
  });
  it("macd warms up for slow period", () => { const m = macd(c); expect(m.dif[24]).toBeNull(); expect(m.dif[25]).not.toBeNull(); });
  it("kd stays in range", () => {
    const b = c.map((v) => ({ h: v + 1, l: v - 1, c: v }));
    const r = kd(b); expect(r.k[7]).toBeNull(); expect(r.k.filter((v) => v != null).every((v) => v! >= 0 && v! <= 100)).toBe(true);
  });
});
