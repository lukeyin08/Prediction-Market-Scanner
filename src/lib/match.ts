import { extractFeatures, type Features } from "./normalize";
import type { BinaryMarket, MatchedPair } from "./types";

export interface MatchOptions {
  /** Minimum final score to accept a pair. */
  threshold?: number;
  /** Reject pairs whose close times differ by more than this many days. */
  maxCloseGapDays?: number;
  /** Cap on candidates scored per Kalshi market. */
  maxCandidates?: number;
}

interface Doc {
  market: BinaryMarket;
  f: Features;
  vec: Map<string, number>;
  norm: number;
}

const DAY_MS = 86_400_000;

export function matchText(m: BinaryMarket): string {
  // Kalshi nests outcome contracts under an event ("Fed decision in December?" /
  // "Cut 25bps"), so the event title carries context the contract title lacks.
  const parts = [m.eventTitle, m.title, m.subtitle].filter(Boolean) as string[];
  const seen = new Set<string>();
  return parts.filter((p) => !seen.has(p) && seen.add(p)).join(" | ");
}

function buildDocs(markets: BinaryMarket[]): { market: BinaryMarket; f: Features }[] {
  return markets.map((market) => ({ market, f: extractFeatures(matchText(market)) }));
}

function vectorize(f: Features, idf: Map<string, number>): { vec: Map<string, number>; norm: number } {
  const tf = new Map<string, number>();
  for (const t of f.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const vec = new Map<string, number>();
  let sq = 0;
  for (const [t, c] of tf) {
    const w = (1 + Math.log(c)) * (idf.get(t) ?? 0);
    if (w <= 0) continue;
    vec.set(t, w);
    sq += w * w;
  }
  return { vec, norm: Math.sqrt(sq) };
}

function cosine(a: Doc, b: Doc): number {
  if (!a.norm || !b.norm) return 0;
  const [small, big] = a.vec.size < b.vec.size ? [a.vec, b.vec] : [b.vec, a.vec];
  let dot = 0;
  for (const [t, w] of small) {
    const v = big.get(t);
    if (v) dot += w * v;
  }
  return dot / (a.norm * b.norm);
}

function sameNumber(x: number, y: number): boolean {
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
}

/**
 * Apply structural constraints on top of text similarity. Returns null when
 * the pair cannot be the same contract, otherwise the adjusted score and the
 * caveats a trader should check before treating it as arbitrage.
 */
export function constrain(
  k: { market: BinaryMarket; f: Features },
  p: { market: BinaryMarket; f: Features },
  base: number,
  maxCloseGapDays: number,
): { score: number; flags: string[] } | null {
  let score = base;
  const flags: string[] = [];

  const kClose = Date.parse(k.market.closeTime);
  const pClose = Date.parse(p.market.closeTime);
  if (Number.isFinite(kClose) && Number.isFinite(pClose)) {
    const gapDays = Math.abs(kClose - pClose) / DAY_MS;
    if (gapDays > maxCloseGapDays) return null;
    score -= 0.15 * (gapDays / maxCloseGapDays);
    if (gapDays >= 2) flags.push(`Close dates differ by ${Math.round(gapDays)} days`);
  }

  const kn = k.f.numbers;
  const pn = p.f.numbers;
  if (kn.length && pn.length) {
    const shared = kn.filter((x) => pn.some((y) => sameNumber(x, y)));
    if (!shared.length) return null;
    if (shared.length !== kn.length || shared.length !== pn.length) {
      score -= 0.1;
      flags.push("Numeric terms only partially match");
    }
  } else if (kn.length || pn.length) {
    score -= 0.12;
    flags.push("Only one side states a numeric threshold");
  }

  if (k.f.years.length && p.f.years.length && !k.f.years.some((y) => p.f.years.includes(y))) {
    return null;
  }
  if (k.f.direction && p.f.direction && k.f.direction !== p.f.direction) return null;
  if (k.f.months.length && p.f.months.length && !k.f.months.some((m) => p.f.months.includes(m))) {
    score -= 0.1;
    flags.push("Different months mentioned");
  }

  return { score, flags };
}

/**
 * Match Kalshi contracts to Polymarket contracts.
 *
 * 1. TF-IDF over normalized tokens, with IDF fit on both venues together.
 * 2. Candidate generation through an inverted index on distinctive tokens.
 * 3. Hard constraints (close date, numeric thresholds, years, over/under)
 *    reject pairs that share words but are different contracts.
 * 4. Mutual best match: a pair is kept only if each side is the other's top
 *    candidate, which removes most one-to-many false positives.
 */
export function matchMarkets(
  kalshi: BinaryMarket[],
  poly: BinaryMarket[],
  opts: MatchOptions = {},
): MatchedPair[] {
  const threshold = opts.threshold ?? 0.5;
  const maxGap = opts.maxCloseGapDays ?? 45;
  const maxCandidates = opts.maxCandidates ?? 60;

  const kRaw = buildDocs(kalshi);
  const pRaw = buildDocs(poly);

  const df = new Map<string, number>();
  for (const d of [...kRaw, ...pRaw]) {
    for (const t of new Set(d.f.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = kRaw.length + pRaw.length;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((n + 1) / (c + 1)) + 1);

  const toDoc = (d: { market: BinaryMarket; f: Features }): Doc => ({ ...d, ...vectorize(d.f, idf) });
  const kDocs = kRaw.map(toDoc);
  const pDocs = pRaw.map(toDoc);

  // Inverted index over Polymarket docs. Very common tokens are skipped for
  // candidate generation (they still count toward the cosine).
  const commonCutoff = Math.max(50, n * 0.05);
  const index = new Map<string, number[]>();
  pDocs.forEach((d, i) => {
    for (const t of d.vec.keys()) {
      if ((df.get(t) ?? 0) > commonCutoff) continue;
      const list = index.get(t);
      if (list) list.push(i);
      else index.set(t, [i]);
    }
  });

  type Cand = { k: number; p: number; score: number; flags: string[] };
  const bestForK = new Map<number, Cand>();
  const bestForP = new Map<number, Cand>();

  kDocs.forEach((kd, ki) => {
    const hits = new Map<number, number>();
    for (const t of kd.vec.keys()) {
      for (const pi of index.get(t) ?? []) hits.set(pi, (hits.get(pi) ?? 0) + (idf.get(t) ?? 0));
    }
    const candidates = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxCandidates);
    for (const [pi] of candidates) {
      const pd = pDocs[pi];
      const base = cosine(kd, pd);
      if (base < threshold * 0.8) continue;
      const c = constrain(kd, pd, base, maxGap);
      if (!c || c.score < threshold) continue;
      const cand = { k: ki, p: pi, score: c.score, flags: c.flags };
      if (!bestForK.has(ki) || bestForK.get(ki)!.score < cand.score) bestForK.set(ki, cand);
      if (!bestForP.has(pi) || bestForP.get(pi)!.score < cand.score) bestForP.set(pi, cand);
    }
  });

  const pairs: MatchedPair[] = [];
  for (const cand of bestForK.values()) {
    const back = bestForP.get(cand.p);
    if (!back || back.k !== cand.k) continue;
    const km = kDocs[cand.k].market;
    const pm = pDocs[cand.p].market;
    pairs.push({
      id: `${km.id}::${pm.id}`,
      kalshi: km,
      polymarket: pm,
      score: Math.round(cand.score * 1000) / 1000,
      flags: cand.flags,
    });
  }
  return pairs.sort((a, b) => b.score - a.score);
}
