import { describe, expect, it } from "bun:test";
import { computeKpis } from "../../src/insights/kpis.js";

describe("computeKpis", () => {
  it("computes totals and ratios", () => {
    const result = computeKpis([
      { impressions: "1000", clicks: "25", spend: "50" },
      { impressions: "500", clicks: "10", spend: "20" },
    ]);

    expect(result.rowCount).toBe(2);
    expect(result.totals.impressions).toBe(1500);
    expect(result.totals.clicks).toBe(35);
    expect(result.totals.spend).toBe(70);
    expect(result.totals.ctr).toBeCloseTo(2.333333, 5);
    expect(result.totals.cpc).toBe(2);
    expect(result.totals.cpm).toBeCloseTo(46.666667, 5);
  });

  it("returns null ratios when denominator is zero", () => {
    const result = computeKpis([{ impressions: "0", clicks: "0", spend: "0" }]);

    expect(result.totals.ctr).toBeNull();
    expect(result.totals.cpc).toBeNull();
    expect(result.totals.cpm).toBeNull();
  });
});
