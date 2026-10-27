import { describe, expect, it } from "vitest";
import { analyze, type Snapshot } from "../src/lib/history";

const stats = { kalshiMarkets: 1, polymarketMarkets: 1, matchedPairs: 1, opportunities: 0, executableProfit: 0, durationMs: 1 };

function snap(t: string, profit: number, dir = "KALSHI_YES+POLY_NO"): Snapshot {
  return {
    t,
    stats: { ...stats, opportunities: profit > 0 ? 1 : 0, executableProfit: profit },
    pairs: [{ id: "A", title: "Pair A", score: 0.8, kMid: 0.4, pMid: 0.5, div: -0.1, dir, topEdge: 0.03, contracts: 100, profit, apr: null }],
  };
}

describe("analyze", () => {
  it("measures how long an opportunity stays open", () => {
    const a = analyze([
      snap("2026-10-27T10:00:00Z", 0),
      snap("2026-10-27T10:30:00Z", 2),
      snap("2026-10-27T11:00:00Z", 3),
      snap("2026-10-27T11:30:00Z", 1),
      snap("2026-10-27T12:00:00Z", 0),
    ]);
    expect(a.episodes).toHaveLength(1);
    expect(a.episodes[0].durationMin).toBe(60);
    expect(a.episodes[0].observations).toBe(3);
    expect(a.episodes[0].peakProfit).toBe(3);
  });

  it("splits episodes when a scheduled run was missed", () => {
    const a = analyze([snap("2026-10-27T10:00:00Z", 2), snap("2026-10-27T14:00:00Z", 2)]);
    expect(a.episodes).toHaveLength(2);
    expect(a.summary.shareSingleScan).toBe(1);
  });

  it("treats a direction flip as a new episode", () => {
    const a = analyze([snap("2026-10-27T10:00:00Z", 2), snap("2026-10-27T10:30:00Z", 2, "POLY_YES+KALSHI_NO")]);
    expect(a.episodes).toHaveLength(2);
  });
});
