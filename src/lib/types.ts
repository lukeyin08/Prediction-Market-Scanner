export type Venue = "kalshi" | "polymarket";

/** One price level of an ask ladder: buy `size` contracts at `price` dollars each. */
export interface Level {
  price: number;
  size: number;
}

/**
 * How a venue charges taker fees.
 * - Kalshi: fee = ceil_to_cent(coeff * C * P * (1 - P)) per fill.
 * - Polymarket: fee = round5(C * rate * (P * (1 - P)) ^ exponent) per fill, charged in USDC.
 */
export type FeeModel =
  | { kind: "kalshi"; coeff: number }
  | { kind: "polymarket"; rate: number; exponent: number };

/** A binary (Yes/No) contract normalized across venues. Prices are in dollars, 0..1. */
export interface BinaryMarket {
  venue: Venue;
  /** Kalshi market ticker, or Polymarket condition id. */
  id: string;
  eventId: string;
  eventTitle: string;
  /** Human-readable contract question. */
  title: string;
  /** Short outcome label inside a multi-outcome event, e.g. "25 bps cut". */
  subtitle?: string;
  url: string;
  /** ISO timestamp when trading closes / the event resolves. */
  closeTime: string;
  yesBid: number | null;
  yesAsk: number | null;
  /** Lifetime volume in contracts (Kalshi) or USDC (Polymarket). */
  volume: number;
  /** Open interest (Kalshi) or displayed liquidity (Polymarket). */
  liquidity: number;
  fee: FeeModel;
  rules?: string;
  /** Polymarket CLOB token ids for the Yes and No outcomes. */
  yesTokenId?: string;
  noTokenId?: string;
}

/** Ask ladders (ascending by price) for buying Yes and No. */
export interface Book {
  yesAsks: Level[];
  noAsks: Level[];
}

export interface MatchedPair {
  id: string;
  kalshi: BinaryMarket;
  polymarket: BinaryMarket;
  /** 0..1 similarity after penalties. */
  score: number;
  /** Human-readable caveats about whether these really resolve identically. */
  flags: string[];
  /** Optional LLM equivalence check. */
  llm?: { same: boolean; note: string };
}

export type Direction = "KALSHI_YES+POLY_NO" | "POLY_YES+KALSHI_NO";

export interface Fill {
  venue: Venue;
  side: "YES" | "NO";
  price: number;
  size: number;
}

export interface ArbResult {
  direction: Direction;
  /** Contracts bought on each leg (one Yes + one No pays exactly $1 at resolution). */
  contracts: number;
  /** Premium paid across both legs, excluding fees. */
  cost: number;
  fees: number;
  /** contracts - cost - fees: locked-in payout if both contracts resolve identically. */
  profit: number;
  /** Net edge per contract at the touch, after fees, in dollars. Null if a side has no asks. */
  topEdge: number | null;
  /** profit / (cost + fees), annualized to the close date. */
  annualizedReturn: number | null;
  fills: Fill[];
}

export interface PairResult {
  id: string;
  kalshi: BinaryMarket;
  polymarket: BinaryMarket;
  score: number;
  flags: string[];
  llm?: { same: boolean; note: string };
  kalshiMid: number | null;
  polyMid: number | null;
  /** kalshiMid - polyMid, in probability points. */
  divergence: number | null;
  best: ArbResult | null;
  alternatives: ArbResult[];
}

export interface ScanStats {
  kalshiMarkets: number;
  polymarketMarkets: number;
  matchedPairs: number;
  opportunities: number;
  executableProfit: number;
  durationMs: number;
}

export interface ScanResult {
  generatedAt: string;
  stats: ScanStats;
  pairs: PairResult[];
  errors: string[];
}
