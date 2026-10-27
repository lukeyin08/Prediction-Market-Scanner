import { feeFor, marginalFee } from "./fees";
import type { ArbResult, Book, Direction, FeeModel, Fill, Level, Venue } from "./types";

export interface Leg {
  venue: Venue;
  side: "YES" | "NO";
  asks: Level[];
  fee: FeeModel;
}

export interface WalkOptions {
  /** Stop after this many contracts per leg. */
  maxContracts?: number;
  /** Require at least this net edge per contract (dollars) on the marginal unit. */
  minMarginalEdge?: number;
  /** Days until the later of the two close times, for annualizing. */
  daysToClose?: number | null;
}

const EPS = 1e-9;

function sortAsks(levels: Level[]): Level[] {
  return levels
    .filter((l) => l.size > EPS && l.price > 0 && l.price < 1)
    .slice()
    .sort((a, b) => a.price - b.price);
}

/**
 * Buying one Yes on venue A and one No on venue B pays exactly $1 at resolution
 * (if both contracts resolve on the same outcome). This walks both ask ladders
 * together, taking liquidity while the marginal unit is still profitable after
 * fees, and returns the exact cost, fees, and locked-in profit.
 */
export function walkLegs(direction: Direction, a: Leg, b: Leg, opts: WalkOptions = {}): ArbResult {
  const maxContracts = opts.maxContracts ?? Number.POSITIVE_INFINITY;
  const minEdge = opts.minMarginalEdge ?? 0;
  const asksA = sortAsks(a.asks);
  const asksB = sortAsks(b.asks);

  const topEdge =
    asksA.length && asksB.length
      ? 1 -
        asksA[0].price -
        asksB[0].price -
        marginalFee(a.fee, asksA[0].price) -
        marginalFee(b.fee, asksB[0].price)
      : null;

  const fills: Fill[] = [];
  let i = 0;
  let j = 0;
  let remA = asksA[0]?.size ?? 0;
  let remB = asksB[0]?.size ?? 0;
  let total = 0;
  // Fill count after each step: candidate stopping points for the best prefix.
  const checkpoints: number[] = [];

  while (i < asksA.length && j < asksB.length && total < maxContracts - EPS) {
    const pa = asksA[i].price;
    const pb = asksB[j].price;
    const edge = 1 - pa - pb - marginalFee(a.fee, pa) - marginalFee(b.fee, pb);
    if (edge <= minEdge + EPS) break;

    // Whole contracts only: a fractional remainder on one leg can't be hedged.
    const q = Math.floor(Math.min(remA, remB, maxContracts - total) + EPS);
    if (q < 1) {
      if (maxContracts - total < 1 - EPS) break;
      if (remA < 1 - EPS) {
        i += 1;
        remA = asksA[i]?.size ?? 0;
      }
      if (remB < 1 - EPS) {
        j += 1;
        remB = asksB[j]?.size ?? 0;
      }
      continue;
    }

    fills.push({ venue: a.venue, side: a.side, price: pa, size: q });
    fills.push({ venue: b.venue, side: b.side, price: pb, size: q });
    checkpoints.push(fills.length);
    total += q;
    remA -= q;
    remB -= q;
    if (remA < 1 - EPS) {
      i += 1;
      remA = asksA[i]?.size ?? 0;
    }
    if (remB < 1 - EPS) {
      j += 1;
      remB = asksB[j]?.size ?? 0;
    }
  }

  // The stop rule above uses unrounded fees, but Kalshi rounds each fill up to
  // a cent, so a thin extra price level can lower total profit. Keep the
  // prefix of steps whose exact, rounded profit is highest.
  const daysToClose = opts.daysToClose ?? null;
  let best = summarize(direction, [], a, b, topEdge, daysToClose);
  for (const n of checkpoints) {
    const candidate = summarize(direction, mergeFills(fills.slice(0, n)), a, b, topEdge, daysToClose);
    if (candidate.profit > best.profit + EPS) best = candidate;
  }
  return best;
}

/** Combine consecutive fills at the same venue/side/price so fees round once per price level. */
function mergeFills(fills: Fill[]): Fill[] {
  const byKey = new Map<string, Fill>();
  for (const f of fills) {
    const key = `${f.venue}|${f.side}|${f.price}`;
    const prev = byKey.get(key);
    if (prev) prev.size += f.size;
    else byKey.set(key, { ...f });
  }
  return [...byKey.values()];
}

function summarize(
  direction: Direction,
  fills: Fill[],
  a: Leg,
  b: Leg,
  topEdge: number | null,
  daysToClose: number | null,
): ArbResult {
  let cost = 0;
  let fees = 0;
  let contractsA = 0;
  for (const f of fills) {
    cost += f.price * f.size;
    const model = f.venue === a.venue && f.side === a.side ? a.fee : b.fee;
    fees += feeFor(model, f.size, f.price);
    if (f.venue === a.venue && f.side === a.side) contractsA += f.size;
  }
  const contracts = contractsA;
  let profit = contracts - cost - fees;

  // Per-fill rounding (Kalshi rounds every fill up to a cent) can turn a
  // razor-thin trade negative. In that case there is no executable trade.
  if (profit <= EPS || contracts <= EPS) {
    return {
      direction,
      contracts: 0,
      cost: 0,
      fees: 0,
      profit: 0,
      topEdge,
      annualizedReturn: null,
      fills: [],
    };
  }

  const capital = cost + fees;
  // Simple (not compounded) annualization; floor at one day so same-day trades still show a figure.
  const annualizedReturn =
    daysToClose !== null && daysToClose > 0 ? (profit / capital) * (365 / Math.max(daysToClose, 1)) : null;
  profit = round(profit, 6);

  return {
    direction,
    contracts: round(contracts, 4),
    cost: round(cost, 6),
    fees: round(fees, 6),
    profit,
    topEdge,
    annualizedReturn,
    fills,
  };
}

function round(x: number, dp: number): number {
  const m = 10 ** dp;
  return Math.round(x * m) / m;
}

/** Evaluate both directions of a Kalshi/Polymarket pair and return them best first. */
export function evaluatePair(
  kalshiBook: Book,
  kalshiFeeModel: FeeModel,
  polyBook: Book,
  polyFeeModel: FeeModel,
  opts: WalkOptions = {},
): ArbResult[] {
  const results = [
    walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: kalshiBook.yesAsks, fee: kalshiFeeModel },
      { venue: "polymarket", side: "NO", asks: polyBook.noAsks, fee: polyFeeModel },
      opts,
    ),
    walkLegs(
      "POLY_YES+KALSHI_NO",
      { venue: "polymarket", side: "YES", asks: polyBook.yesAsks, fee: polyFeeModel },
      { venue: "kalshi", side: "NO", asks: kalshiBook.noAsks, fee: kalshiFeeModel },
      opts,
    ),
  ];
  return results.sort((x, y) => y.profit - x.profit || (y.topEdge ?? -1) - (x.topEdge ?? -1));
}

/** Midpoint of a two-sided quote. A one-sided quote (no bid, or no ask) has no meaningful midpoint. */
export function midpoint(bid: number | null, ask: number | null): number | null {
  return bid !== null && ask !== null ? (bid + ask) / 2 : null;
}
