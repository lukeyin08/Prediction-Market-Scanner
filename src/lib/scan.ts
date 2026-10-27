import { evaluatePair, midpoint } from "./arb";
import { fetchKalshiBooks, fetchKalshiMarkets } from "./kalshi";
import { verifyPairs } from "./llm";
import { matchMarkets } from "./match";
import { fetchPolymarketBooks, fetchPolymarketMarkets } from "./polymarket";
import type { BinaryMarket, Book, MatchedPair, PairResult, ScanResult } from "./types";

export interface ScanOptions {
  /** Ignore contracts closing further out than this. */
  maxDaysToClose?: number;
  /** Ignore illiquid contracts: Kalshi open interest / Polymarket liquidity below this. */
  minLiquidity?: number;
  /** Fetch order books for at most this many matched pairs. */
  maxPairs?: number;
  /** Cap contracts per trade when walking books. */
  maxContracts?: number;
  kalshiPages?: number;
  polymarketPages?: number;
  now?: Date;
  /** Abort every outstanding request after this many ms and return what was gathered. */
  deadlineMs?: number;
  /** Run the optional LLM equivalence check (costs API calls; off for user-facing requests). */
  verify?: boolean;
}

const DAY_MS = 86_400_000;

export function liveFilter(markets: BinaryMarket[], now: number, maxDays: number, minLiquidity: number): BinaryMarket[] {
  return markets.filter((m) => {
    const close = Date.parse(m.closeTime);
    if (!Number.isFinite(close) || close <= now || close - now > maxDays * DAY_MS) return false;
    if (m.yesBid === null && m.yesAsk === null) return false;
    return m.liquidity >= minLiquidity || m.volume >= minLiquidity * 10;
  });
}

export function evaluateMatches(
  pairs: MatchedPair[],
  kalshiBooks: Map<string, Book>,
  polyBooks: Map<string, Book>,
  opts: { maxContracts?: number; now?: number } = {},
): PairResult[] {
  const now = opts.now ?? Date.now();
  return pairs.map((pair) => {
    const kb = kalshiBooks.get(pair.kalshi.id);
    const pb = polyBooks.get(pair.polymarket.id);
    const laterClose = Math.max(Date.parse(pair.kalshi.closeTime), Date.parse(pair.polymarket.closeTime));
    const daysToClose = Number.isFinite(laterClose) ? (laterClose - now) / DAY_MS : null;

    const results =
      kb && pb
        ? evaluatePair(kb, pair.kalshi.fee, pb, pair.polymarket.fee, {
            maxContracts: opts.maxContracts ?? 5_000,
            daysToClose,
          })
        : [];

    const kalshiMid = midpoint(pair.kalshi.yesBid, pair.kalshi.yesAsk);
    const polyMid = midpoint(pair.polymarket.yesBid, pair.polymarket.yesAsk);
    const llmRejects = pair.llm && !pair.llm.same;
    const best = results[0] && results[0].profit > 0 && !llmRejects ? results[0] : null;

    return {
      id: pair.id,
      kalshi: pair.kalshi,
      polymarket: pair.polymarket,
      score: pair.score,
      flags: pair.flags,
      llm: pair.llm,
      kalshiMid,
      polyMid,
      divergence: kalshiMid !== null && polyMid !== null ? round(kalshiMid - polyMid, 4) : null,
      best,
      alternatives: results,
    };
  });
}

function round(x: number, dp: number): number {
  const m = 10 ** dp;
  return Math.round(x * m) / m;
}

export async function runScan(opts: ScanOptions = {}): Promise<ScanResult> {
  const started = Date.now();
  const now = (opts.now ?? new Date()).getTime();
  // One shared deadline for every request, so a slow venue can't outlive the caller's time limit.
  const signal = opts.deadlineMs ? AbortSignal.timeout(opts.deadlineMs) : undefined;

  const [kRes, pRes] = await Promise.all([
    fetchKalshiMarkets({ maxPages: opts.kalshiPages, signal }),
    fetchPolymarketMarkets({ maxPages: opts.polymarketPages, signal, minLiquidity: opts.minLiquidity ?? 50 }),
  ]);
  const errors = [...kRes.errors, ...pRes.errors];
  const warnings = [...kRes.warnings, ...pRes.warnings];

  const maxDays = opts.maxDaysToClose ?? 400;
  const minLiq = opts.minLiquidity ?? 50;
  const kalshi = liveFilter(kRes.data, now, maxDays, minLiq);
  const poly = liveFilter(pRes.data, now, maxDays, minLiq);

  const allMatched = matchMarkets(kalshi, poly);
  const maxPairs = opts.maxPairs ?? 400;
  if (allMatched.length > maxPairs) warnings.push(`Pair cap reached: priced the top ${maxPairs} of ${allMatched.length} matches`);
  const matched = allMatched.slice(0, maxPairs);
  if (opts.verify) await verifyPairs(matched, { signal });

  const [kBooks, pBooks] = await Promise.all([
    fetchKalshiBooks(
      matched.map((p) => p.kalshi.id),
      { signal },
    ),
    fetchPolymarketBooks(
      matched.map((p) => p.polymarket),
      { signal },
    ),
  ]);
  if (kBooks.failed) errors.push(`Kalshi order books unavailable for ${kBooks.failed} of ${matched.length} pairs`);
  if (pBooks.failed) errors.push(`Polymarket order books unavailable for ${pBooks.failed} of ${matched.length} pairs`);

  const pairs = evaluateMatches(matched, kBooks.books, pBooks.books, { maxContracts: opts.maxContracts, now });
  pairs.sort(
    (a, b) =>
      (b.best?.profit ?? 0) - (a.best?.profit ?? 0) ||
      Math.abs(b.divergence ?? 0) - Math.abs(a.divergence ?? 0),
  );

  const opportunities = pairs.filter((p) => p.best);
  const booksMissing = Math.max(kBooks.failed, pBooks.failed);
  return {
    generatedAt: new Date(now).toISOString(),
    stats: {
      kalshiMarkets: kalshi.length,
      polymarketMarkets: poly.length,
      matchedPairs: pairs.length,
      opportunities: opportunities.length,
      executableProfit: round(
        opportunities.reduce((s, p) => s + (p.best?.profit ?? 0), 0),
        2,
      ),
      durationMs: Date.now() - started,
    },
    pairs,
    errors,
    warnings,
    // Complete = both venues fully paged and nearly every matched pair has depth.
    complete: !kRes.errors.length && !pRes.errors.length && booksMissing <= Math.max(2, matched.length * 0.1),
  };
}
