import type { ScanResult } from "./types";
import { SCANNER_VERSION } from "./version";

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
  /** Both order books were fetched, so "profit 0" really means no edge (not missing data). */
  priced?: boolean;
}

export interface Snapshot {
  t: string;
  /** Scanner version that produced this snapshot (absent = 1). */
  v?: number;
  /** False if a venue failed to page fully or many books were missing. */
  complete?: boolean;
  stats: ScanResult["stats"];
  pairs: SnapshotPair[];
}

export function toSnapshot(scan: ScanResult): Snapshot {
  return {
    t: scan.generatedAt,
    v: SCANNER_VERSION,
    complete: scan.complete ?? !scan.errors.length,
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
        priced: p.alternatives.length > 0,
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
  /** Last profitable sighting minus first: a lower bound on the lifetime. */
  durationMin: number;
  /**
   * From the last scan that saw this pair priced and unprofitable before the
   * episode, to the first such scan after it: an upper bound. Null when either
   * side is unknown (censored).
   */
  upperMin: number | null;
  observations: number;
  peakProfit: number;
  peakEdge: number;
  /** "left": already open at the first scan; "right": still open at the last scan. */
  censored: "left" | "right" | "both" | null;
}

export interface Analysis {
  generatedAt: string;
  scannerVersion: number;
  scans: number;
  /** Snapshots skipped because an older scanner version produced them. */
  skippedOldVersion: number;
  firstScan: string | null;
  lastScan: string | null;
  timeseries: { t: string; matchedPairs: number; opportunities: number; executableProfit: number }[];
  episodes: Episode[];
  summary: {
    episodes: number;
    /** Episodes with both ends observed; the lifetime stats use only these. */
    completed: number;
    openNow: number;
    medianDurationMin: number | null;
    p90DurationMin: number | null;
    medianUpperMin: number | null;
    shareSingleScan: number | null;
    pairsSeen: number;
    pairsEverArbitrageable: number;
    medianPeakProfit: number | null;
  };
  /** Completed-episode lifetime histogram (lower-bound minutes). */
  durationHistogram: { bucket: string; count: number }[];
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function downsample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  return Array.from({ length: max }, (_, i) => xs[Math.floor(i * step)]).concat(xs.at(-1)!);
}

/**
 * Turn a time series of scans into arbitrage "episodes": runs of scans in
 * which the same pair stayed profitable in the same direction.
 *
 * An episode only ends on evidence: a scan that priced the pair (both books
 * present) and found no profit in that direction. A scan that is incomplete,
 * or where the pair is missing or unpriced, is treated as a gap rather than
 * a close. A gap longer than `maxGapMin` ends the episode as censored.
 */
export function analyze(
  snapshots: Snapshot[],
  opts: { maxGapMin?: number; scannerVersion?: number; maxEpisodes?: number; maxPoints?: number } = {},
): Analysis {
  const maxGapMs = (opts.maxGapMin ?? 75) * 60_000;
  const version = opts.scannerVersion ?? SCANNER_VERSION;
  const snaps = snapshots
    .filter((s) => (s.v ?? 1) === version && Number.isFinite(Date.parse(s.t)))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));

  type Open = Episode & { lastT: number; startPrevT: number | null };
  const open = new Map<string, Open>();
  const done: Episode[] = [];
  const seen = new Set<string>();
  const everArb = new Set<string>();
  /** Last scan time at which each pair+direction was priced and unprofitable. */
  const lastFlat = new Map<string, number>();

  const finish = (key: string, closedAt: number | null, censoredRight: boolean) => {
    const ep = open.get(key);
    if (!ep) return;
    const { lastT: _l, startPrevT, ...rest } = ep;
    const left = rest.censored === "left";
    rest.censored = left && censoredRight ? "both" : left ? "left" : censoredRight ? "right" : null;
    rest.upperMin =
      startPrevT !== null && closedAt !== null && !censoredRight ? (closedAt - startPrevT) / 60_000 : null;
    done.push(rest);
    open.delete(key);
  };

  snaps.forEach((s, idx) => {
    const t = Date.parse(s.t);
    // Close anything not re-observed within the gap limit: we can't tell when it ended.
    for (const [key, ep] of [...open.entries()]) if (t - ep.lastT > maxGapMs) finish(key, null, true);

    for (const p of s.pairs) {
      seen.add(p.id);
      if (p.profit > 0 && p.dir) everArb.add(p.id);
    }

    // Extend or start episodes.
    for (const p of s.pairs) {
      if (!(p.profit > 0) || !p.dir) continue;
      const key = `${p.id}|${p.dir}`;
      const ep = open.get(key);
      if (ep) {
        ep.end = s.t;
        ep.lastT = t;
        ep.durationMin = (t - Date.parse(ep.start)) / 60_000;
        ep.observations += 1;
        ep.peakProfit = Math.max(ep.peakProfit, p.profit);
        ep.peakEdge = Math.max(ep.peakEdge, p.topEdge ?? 0);
      } else {
        const prevFlat = lastFlat.get(key) ?? null;
        open.set(key, {
          pairId: p.id,
          title: p.title,
          direction: p.dir,
          start: s.t,
          end: s.t,
          durationMin: 0,
          upperMin: null,
          observations: 1,
          peakProfit: p.profit,
          peakEdge: p.topEdge ?? 0,
          censored: idx === 0 ? "left" : null,
          lastT: t,
          startPrevT: prevFlat,
        });
      }
    }

    // Close episodes only on evidence, and remember where each pair was flat.
    if (s.complete !== false) {
      for (const p of s.pairs) {
        if (p.priced === false) continue;
        for (const dir of ["KALSHI_YES+POLY_NO", "POLY_YES+KALSHI_NO"]) {
          const key = `${p.id}|${dir}`;
          const profitableHere = p.profit > 0 && p.dir === dir;
          if (profitableHere) continue;
          lastFlat.set(key, t);
          if (open.has(key)) finish(key, t, false);
        }
      }
    }
  });

  const openNow = open.size;
  for (const key of [...open.keys()]) finish(key, null, true);

  const completed = done.filter((e) => e.censored === null);
  const durations = completed.map((e) => e.durationMin).sort((a, b) => a - b);
  const uppers = completed.map((e) => e.upperMin).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const profits = done.map((e) => e.peakProfit).sort((a, b) => a - b);
  const buckets: [string, number, number][] = [
    ["single scan", -1, -1],
    ["< 1h", 0, 60],
    ["1–6h", 60, 360],
    ["6–24h", 360, 1440],
    ["1–3d", 1440, 4320],
    ["> 3d", 4320, Number.POSITIVE_INFINITY],
  ];

  const maxEpisodes = opts.maxEpisodes ?? 200;
  return {
    generatedAt: new Date().toISOString(),
    scannerVersion: version,
    scans: snaps.length,
    skippedOldVersion: snapshots.length - snaps.length,
    firstScan: snaps[0]?.t ?? null,
    lastScan: snaps.at(-1)?.t ?? null,
    timeseries: downsample(
      snaps.map((s) => ({
        t: s.t,
        matchedPairs: s.stats.matchedPairs,
        opportunities: s.stats.opportunities,
        executableProfit: s.stats.executableProfit,
      })),
      opts.maxPoints ?? 1000,
    ),
    episodes: done.sort((a, b) => b.peakProfit - a.peakProfit).slice(0, maxEpisodes),
    summary: {
      episodes: done.length,
      completed: completed.length,
      openNow,
      medianDurationMin: quantile(durations, 0.5),
      p90DurationMin: quantile(durations, 0.9),
      medianUpperMin: quantile(uppers, 0.5),
      shareSingleScan: completed.length ? completed.filter((e) => e.observations === 1).length / completed.length : null,
      pairsSeen: seen.size,
      pairsEverArbitrageable: everArb.size,
      medianPeakProfit: quantile(profits, 0.5),
    },
    durationHistogram: buckets.map(([bucket, lo, hi]) => ({
      bucket,
      count: completed.filter((e) =>
        lo < 0 ? e.observations === 1 : e.observations > 1 && e.durationMin >= lo && e.durationMin < hi,
      ).length,
    })),
  };
}
