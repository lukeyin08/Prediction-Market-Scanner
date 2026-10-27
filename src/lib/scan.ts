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
}

const DAY_MS = 86_400_000;

function liveFilter(markets: BinaryMarket[], now: number, maxDays: number, minLiquidity: number): BinaryMarket[] {
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
  const errors: string[] = [];

  const [kalshiAll, polyAll] = await Promise.all([
    fetchKalshiMarkets({ maxPages: opts.kalshiPages }).catch((e) => {
      errors.push(`Kalshi markets: ${String(e?.message ?? e)}`);
      return [] as BinaryMarket[];
    }),
    fetchPolymarketMarkets({ maxPages: opts.polymarketPages }).catch((e) => {
      errors.push(`Polymarket markets: ${String(e?.message ?? e)}`);
      return [] as BinaryMarket[];
    }),
  ]);

  const maxDays = opts.maxDaysToClose ?? 400;
  const minLiq = opts.minLiquidity ?? 50;
  const kalshi = liveFilter(kalshiAll, now, maxDays, minLiq);
  const poly = liveFilter(polyAll, now, maxDays, minLiq);

  const matched = matchMarkets(kalshi, poly).slice(0, opts.maxPairs ?? 150);
  await verifyPairs(matched);

  const [kalshiBooks, polyBooks] = await Promise.all([
    fetchKalshiBooks(matched.map((p) => p.kalshi.id)),
    fetchPolymarketBooks(matched.map((p) => p.polymarket)),
  ]);

  const pairs = evaluateMatches(matched, kalshiBooks, polyBooks, { maxContracts: opts.maxContracts, now });
  pairs.sort(
    (a, b) =>
      (b.best?.profit ?? 0) - (a.best?.profit ?? 0) ||
      Math.abs(b.divergence ?? 0) - Math.abs(a.divergence ?? 0),
  );

  const opportunities = pairs.filter((p) => p.best);
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
  };
}
