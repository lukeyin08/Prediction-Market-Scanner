import { errorMessage, fetchJson, mapLimit, num } from "./http";
import type { FetchResult } from "./kalshi";
import type { BinaryMarket, Book, FeeModel, Level } from "./types";

export const GAMMA_BASE = process.env.POLYMARKET_GAMMA_BASE ?? "https://gamma-api.polymarket.com";
export const CLOB_BASE = process.env.POLYMARKET_CLOB_BASE ?? "https://clob.polymarket.com";

/** Fields we use from Gamma's market object. Several arrays arrive JSON-encoded as strings. */
export interface PolyMarketRaw {
  id?: string;
  conditionId: string;
  question?: string;
  groupItemTitle?: string;
  description?: string;
  slug?: string;
  endDate?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  bestBid?: number | string;
  bestAsk?: number | string;
  volumeNum?: number;
  volume?: string;
  liquidityNum?: number;
  liquidity?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  feesEnabled?: boolean;
  feeType?: string;
  feeSchedule?: { rate?: number; exponent?: number; takerOnly?: boolean } | null;
}

export interface PolyEventRaw {
  id: string;
  title?: string;
  slug?: string;
  endDate?: string;
  markets?: PolyMarketRaw[];
}

interface ClobBook {
  asset_id: string;
  bids?: { price: string; size: string }[];
  asks?: { price: string; size: string }[];
}

function parseList(x: string | string[] | undefined): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map(String);
  try {
    const v = JSON.parse(x);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function polyFeeModel(m: PolyMarketRaw): FeeModel {
  const rate = m.feeSchedule?.rate ?? 0;
  // Conservative: charge whenever a rate is published, unless the market says it's fee-free.
  const charged = rate > 0 && m.feesEnabled !== false && m.feeType !== "zero_fees";
  return { kind: "polymarket", rate: charged ? rate : 0, exponent: m.feeSchedule?.exponent ?? 1 };
}

function quote(x: number | string | undefined): number | null {
  const v = num(x);
  return v === null || v <= 0 || v >= 1 ? null : v;
}

export function normalizePolyMarket(ev: PolyEventRaw, m: PolyMarketRaw): BinaryMarket | null {
  if (m.closed || m.archived || m.active === false) return null;
  if (m.enableOrderBook === false || m.acceptingOrders === false) return null;
  const outcomes = parseList(m.outcomes).map((o) => o.toLowerCase());
  if (outcomes.length !== 2 || outcomes[0] !== "yes" || outcomes[1] !== "no") return null;
  const tokens = parseList(m.clobTokenIds);
  if (tokens.length !== 2) return null;
  const title = m.question ?? ev.title ?? m.conditionId;
  return {
    venue: "polymarket",
    id: m.conditionId,
    eventId: ev.id,
    eventTitle: ev.title ?? "",
    title,
    subtitle: m.groupItemTitle && m.groupItemTitle !== title ? m.groupItemTitle : undefined,
    url: `https://polymarket.com/event/${ev.slug ?? m.slug ?? ""}`,
    closeTime: m.endDate ?? ev.endDate ?? "",
    yesBid: quote(m.bestBid),
    yesAsk: quote(m.bestAsk),
    volume: m.volumeNum ?? num(m.volume) ?? 0,
    liquidity: m.liquidityNum ?? num(m.liquidity) ?? 0,
    fee: polyFeeModel(m),
    rules: m.description,
    yesTokenId: tokens[0],
    noTokenId: tokens[1],
  };
}

/**
 * Page through every open event with Gamma's keyset (cursor) endpoint. The
 * offset-based /events endpoint rejects offsets past ~2,000, which silently
 * truncates coverage. Hitting our own page cap is reported as a warning.
 */
export async function fetchPolymarketMarkets(
  opts: { maxPages?: number; signal?: AbortSignal; minLiquidity?: number } = {},
): Promise<FetchResult<BinaryMarket[]>> {
  const out: BinaryMarket[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const maxPages = opts.maxPages ?? 300;
  let cursor: string | undefined;
  let events = 0;
  let page = 0;
  for (; page < maxPages; page++) {
    const qs = new URLSearchParams({ closed: "false", limit: "100" });
    if (opts.minLiquidity) qs.set("liquidity_min", String(opts.minLiquidity));
    if (cursor) qs.set("after_cursor", cursor);
    let data: { events?: PolyEventRaw[]; next_cursor?: string };
    try {
      data = await fetchJson(`${GAMMA_BASE}/events/keyset?${qs}`, { signal: opts.signal });
    } catch (e) {
      errors.push(`Polymarket events page ${page + 1}: ${errorMessage(e)}`);
      break;
    }
    for (const ev of data.events ?? []) {
      events += 1;
      for (const m of ev.markets ?? []) {
        const bm = normalizePolyMarket(ev, m);
        if (bm) out.push(bm);
      }
    }
    cursor = data.next_cursor || undefined;
    if (!cursor || !(data.events ?? []).length) break;
  }
  if (page === maxPages) warnings.push(`Polymarket pagination cap reached (${maxPages} pages, ${events} events)`);
  return { data: out, errors, warnings };
}

export function toAsks(levels: { price: string; size: string }[] | undefined): Level[] {
  return (levels ?? [])
    .map((l) => ({ price: Number(l.price), size: Number(l.size) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0)
    .sort((a, b) => a.price - b.price); // sort ourselves: don't rely on API ordering
}

/** Fetch Yes and No ask ladders for many markets via the batch /books endpoint (chunks run in parallel). */
export async function fetchPolymarketBooks(
  markets: BinaryMarket[],
  opts: { chunk?: number; signal?: AbortSignal } = {},
): Promise<{ books: Map<string, Book>; failed: number }> {
  const chunk = opts.chunk ?? 40;
  const tokenIds = markets.flatMap((m) => [m.yesTokenId, m.noTokenId]).filter(Boolean) as string[];
  const chunks: string[][] = [];
  for (let i = 0; i < tokenIds.length; i += chunk) chunks.push(tokenIds.slice(i, i + chunk));

  const asksByToken = new Map<string, Level[]>();
  await mapLimit(chunks, 4, async (ids) => {
    try {
      const books = await fetchJson<ClobBook[]>(`${CLOB_BASE}/books`, {
        method: "POST",
        body: ids.map((token_id) => ({ token_id })),
        signal: opts.signal,
      });
      for (const b of books) asksByToken.set(b.asset_id, toAsks(b.asks));
    } catch {
      // counted below as markets without a book
    }
  });

  const books = new Map<string, Book>();
  let failed = 0;
  for (const m of markets) {
    const yes = m.yesTokenId ? asksByToken.get(m.yesTokenId) : undefined;
    const no = m.noTokenId ? asksByToken.get(m.noTokenId) : undefined;
    if (yes || no) books.set(m.id, { yesAsks: yes ?? [], noAsks: no ?? [] });
    else failed += 1;
  }
  return { books, failed };
}
