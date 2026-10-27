import type { ScanResult } from "./types";

/** One compact row per matched pair per scan, as stored in snapshots/*.jsonl. */
export interface SnapshotPair {
  id: string;
  title: string;
  score: number;
  kMid: number | null;
  pMid: number | null;
  div: number | null;
  dir: string | null;
  topEdge: number | null;
  contracts: number;
  profit: number;
  apr: number | null;
}

export interface Snapshot {
  t: string;
  stats: ScanResult["stats"];
  pairs: SnapshotPair[];
}

export function toSnapshot(scan: ScanResult): Snapshot {
  return {
    t: scan.generatedAt,
    stats: scan.stats,
    pairs: scan.pairs.map((p) => {
      const top = p.alternatives[0];
      return {
        id: p.id,
        title: p.kalshi.subtitle ? `${p.kalshi.eventTitle}: ${p.kalshi.subtitle}` : p.kalshi.title,
        score: p.score,
        kMid: p.kalshiMid,
        pMid: p.polyMid,
        div: p.divergence,
        dir: p.best?.direction ?? top?.direction ?? null,
        topEdge: top?.topEdge ?? null,
        contracts: p.best?.contracts ?? 0,
        profit: p.best?.profit ?? 0,
        apr: p.best?.annualizedReturn ?? null,
      };
    }),
  };
}

export interface Episode {
  pairId: string;
  title: string;
  direction: string;
  start: string;
  end: string;
  /** Observed lifetime: last sighting minus first sighting. Lower bound on true lifetime. */
  durationMin: number;
  observations: number;
  peakProfit: number;
  peakEdge: number;
}

export interface Analysis {
  generatedAt: string;
  scans: number;
  firstScan: string | null;
  lastScan: string | null;
  timeseries: { t: string; matchedPairs: number; opportunities: number; executableProfit: number }[];
  episodes: Episode[];
  summary: {
    episodes: number;
    medianDurationMin: number | null;
    p90DurationMin: number | null;
    shareSingleScan: number | null;
    pairsSeen: number;
    pairsEverArbitrageable: number;
    medianPeakProfit: number | null;
  };
  /** Episode duration histogram buckets (minutes). */
  durationHistogram: { bucket: string; count: number }[];
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Turn a time series of scans into arbitrage "episodes": runs of consecutive
 * scans in which the same pair stayed profitable in the same direction. A gap
 * longer than `maxGapMin` between scans (a missed run) ends the episode.
 */
export function analyze(snapshots: Snapshot[], opts: { maxGapMin?: number } = {}): Analysis {
  const maxGapMs = (opts.maxGapMin ?? 75) * 60_000;
  const snaps = snapshots.slice().sort((a, b) => Date.parse(a.t) - Date.parse(b.t));

  type Open = Episode & { lastT: number };
  const open = new Map<string, Open>();
  const done: Episode[] = [];
  const seen = new Set<string>();
  const everArb = new Set<string>();
  let prevT: number | null = null;

  const close = (key: string) => {
    const ep = open.get(key);
    if (!ep) return;
    const { lastT: _lastT, ...rest } = ep;
    done.push(rest);
    open.delete(key);
  };

  for (const s of snaps) {
    const t = Date.parse(s.t);
    if (prevT !== null && t - prevT > maxGapMs) for (const key of [...open.keys()]) close(key);
    const live = new Set<string>();
    for (const p of s.pairs) {
      seen.add(p.id);
      if (!(p.profit > 0) || !p.dir) continue;
      everArb.add(p.id);
      const key = `${p.id}|${p.dir}`;
      live.add(key);
      const ep = open.get(key);
      if (ep) {
        ep.end = s.t;
        ep.lastT = t;
        ep.durationMin = (t - Date.parse(ep.start)) / 60_000;
        ep.observations += 1;
        ep.peakProfit = Math.max(ep.peakProfit, p.profit);
        ep.peakEdge = Math.max(ep.peakEdge, p.topEdge ?? 0);
      } else {
        open.set(key, {
          pairId: p.id,
          title: p.title,
          direction: p.dir,
          start: s.t,
          end: s.t,
          durationMin: 0,
          observations: 1,
          peakProfit: p.profit,
          peakEdge: p.topEdge ?? 0,
          lastT: t,
        });
      }
    }
    for (const key of [...open.keys()]) if (!live.has(key)) close(key);
    prevT = t;
  }
  for (const key of [...open.keys()]) close(key);

  const durations = done.map((e) => e.durationMin).sort((a, b) => a - b);
  const profits = done.map((e) => e.peakProfit).sort((a, b) => a - b);
  const buckets: [string, number, number][] = [
    ["single scan", 0, 0],
    ["< 1h", 0.0001, 60],
    ["1–6h", 60, 360],
    ["6–24h", 360, 1440],
    ["1–3d", 1440, 4320],
    ["> 3d", 4320, Number.POSITIVE_INFINITY],
  ];

  return {
    generatedAt: new Date().toISOString(),
    scans: snaps.length,
    firstScan: snaps[0]?.t ?? null,
    lastScan: snaps.at(-1)?.t ?? null,
    timeseries: snaps.map((s) => ({
      t: s.t,
      matchedPairs: s.stats.matchedPairs,
      opportunities: s.stats.opportunities,
      executableProfit: s.stats.executableProfit,
    })),
    episodes: done.sort((a, b) => b.peakProfit - a.peakProfit),
    summary: {
      episodes: done.length,
      medianDurationMin: quantile(durations, 0.5),
      p90DurationMin: quantile(durations, 0.9),
      shareSingleScan: done.length ? done.filter((e) => e.observations === 1).length / done.length : null,
      pairsSeen: seen.size,
      pairsEverArbitrageable: everArb.size,
      medianPeakProfit: quantile(profits, 0.5),
    },
    durationHistogram: buckets.map(([bucket, lo, hi]) => ({
      bucket,
      count: done.filter((e) =>
        hi === 0 ? e.observations === 1 : e.observations > 1 && e.durationMin >= lo && e.durationMin < hi,
      ).length,
    })),
  };
}
