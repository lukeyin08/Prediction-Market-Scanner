import { describe, expect, it } from "vitest";
import { analyze, type Snapshot, type SnapshotPair } from "../src/lib/history";
import { SCANNER_VERSION } from "../src/lib/version";

const stats = { kalshiMarkets: 1, polymarketMarkets: 1, matchedPairs: 1, opportunities: 0, executableProfit: 0, durationMs: 1 };
const DIR = "KALSHI_YES+POLY_NO";

function pair(id: string, profit: number, extra: Partial<SnapshotPair> = {}): SnapshotPair {
  return { id, title: `Pair ${id}`, score: 0.8, kMid: 0.4, pMid: 0.5, div: -0.1, dir: DIR, topEdge: 0.03, contracts: 100, profit, apr: null, priced: true, ...extra };
}

function snap(t: string, pairs: SnapshotPair[], extra: Partial<Snapshot> = {}): Snapshot {
  return { t, v: SCANNER_VERSION, complete: true, stats, pairs, ...extra };
}

const T = (hhmm: string) => `2026-10-27T${hhmm}:00Z`;

describe("analyze", () => {
  it("measures a completed episode with lower and upper bounds", () => {
    const a = analyze([
      snap(T("10:00"), [pair("A", 0)]),
      snap(T("10:30"), [pair("A", 2)]),
      snap(T("11:00"), [pair("A", 3)]),
      snap(T("11:30"), [pair("A", 1)]),
      snap(T("12:00"), [pair("A", 0)]),
    ]);
    expect(a.episodes).toHaveLength(1);
    const e = a.episodes[0];
    expect(e.censored).toBeNull();
    expect(e.durationMin).toBe(60); // first to last profitable sighting
    expect(e.upperMin).toBe(120); // last flat before (10:00) to first flat after (12:00)
    expect(e.observations).toBe(3);
    expect(e.peakProfit).toBe(3);
    expect(a.summary.completed).toBe(1);
    expect(a.summary.medianDurationMin).toBe(60);
  });

  it("does not end an episode when the pair is missing or unpriced", () => {
    const a = analyze([
      snap(T("10:00"), [pair("A", 0)]),
      snap(T("10:30"), [pair("A", 2)]),
      snap(T("11:00"), []), // dropped from the scan
      snap(T("11:30"), [pair("A", 2)]),
      snap(T("12:00"), [pair("A", 0, { priced: false, dir: null })]), // book fetch failed
      snap(T("12:30"), [pair("A", 2)]),
      snap(T("13:00"), [pair("A", 0)]),
    ]);
    expect(a.episodes).toHaveLength(1);
    expect(a.episodes[0].durationMin).toBe(120);
    expect(a.episodes[0].censored).toBeNull();
  });

  it("ends an episode on a priced, flat observation even if the scan hit a coverage limit", () => {
    const a = analyze([
      snap(T("10:00"), [pair("A", 0)]),
      snap(T("10:30"), [pair("A", 2)]),
      snap(T("11:00"), [pair("A", 0)], { complete: false }),
    ]);
    expect(a.episodes).toHaveLength(1);
    expect(a.episodes[0].censored).toBeNull();
  });

  it("marks episodes cut off by the start or end of the data as censored and excludes them from lifetime stats", () => {
    const a = analyze([
      snap(T("10:00"), [pair("L", 2), pair("C", 0)]),
      snap(T("10:30"), [pair("L", 0), pair("C", 2)]),
      snap(T("11:00"), [pair("L", 0), pair("C", 0), pair("R", 2)]),
    ]);
    const byId = Object.fromEntries(a.episodes.map((e) => [e.pairId, e]));
    expect(byId.L.censored).toBe("left");
    expect(byId.R.censored).toBe("right");
    expect(byId.C.censored).toBeNull();
    expect(a.summary.completed).toBe(1);
    expect(a.summary.openNow).toBe(1);
    expect(a.summary.shareSingleScan).toBe(1);
  });

  it("ends an episode as censored after a long gap between scans", () => {
    const a = analyze([snap(T("10:00"), [pair("A", 0)]), snap(T("10:30"), [pair("A", 2)]), snap(T("14:00"), [pair("A", 0)])]);
    expect(a.episodes).toHaveLength(1);
    expect(a.episodes[0].censored).toBe("right");
    expect(a.summary.completed).toBe(0);
  });

  it("treats a direction flip as a new episode", () => {
    const a = analyze([
      snap(T("10:00"), [pair("A", 0)]),
      snap(T("10:30"), [pair("A", 2)]),
      snap(T("11:00"), [pair("A", 2, { dir: "POLY_YES+KALSHI_NO" })]),
      snap(T("11:30"), [pair("A", 0)]),
    ]);
    expect(a.episodes).toHaveLength(2);
    expect(a.episodes.every((e) => e.censored === null)).toBe(true);
  });

  it("ignores snapshots produced by another scanner version", () => {
    const old = { ...snap(T("09:30"), [pair("A", 99)]), v: undefined };
    const a = analyze([old, snap(T("10:00"), [pair("A", 2)])]);
    expect(a.scans).toBe(1);
    expect(a.skippedOldVersion).toBe(1);
    expect(a.episodes[0].peakProfit).toBe(2);
  });

  it("buckets completed lifetimes, with zero-length multi-scan episodes in < 1h", () => {
    const a = analyze([
      snap(T("10:00"), [pair("A", 0), pair("B", 0)]),
      snap(T("10:30"), [pair("A", 2), pair("B", 2)]),
      snap(T("11:00"), [pair("A", 0), pair("B", 2)]),
      snap(T("11:30"), [pair("A", 0), pair("B", 0)]),
    ]);
    const h = Object.fromEntries(a.durationHistogram.map((b) => [b.bucket, b.count]));
    expect(h["single scan"]).toBe(1);
    expect(h["< 1h"]).toBe(1);
  });
});
