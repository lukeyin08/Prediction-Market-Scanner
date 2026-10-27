import { KALSHI_DEFAULT_COEFF, KALSHI_SERIES_COEFF } from "./fees";
import { errorMessage, fetchJson, mapLimit, num } from "./http";
import type { BinaryMarket, Book, Level } from "./types";

export const KALSHI_BASE = process.env.KALSHI_API_BASE ?? "https://api.elections.kalshi.com/trade-api/v2";

/** Fields we use from Kalshi's market object. Prices are dollar strings ("0.4200"). */
export interface KalshiMarketRaw {
  ticker: string;
  event_ticker: string;
  market_type?: string;
  status?: string;
  title?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  close_time?: string;
  expected_expiration_time?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  volume_fp?: string;
  open_interest_fp?: string;
  rules_primary?: string;
  mve_collection_ticker?: string;
}

export interface KalshiEventRaw {
  event_ticker: string;
  series_ticker?: string;
  title?: string;
  sub_title?: string;
  category?: string;
  markets?: KalshiMarketRaw[];
}

interface EventsPage {
  events: KalshiEventRaw[];
  cursor?: string;
}

interface OrderbookResponse {
  orderbook_fp?: {
    yes_dollars?: [string, string][] | null;
    no_dollars?: [string, string][] | null;
  };
}

export function seriesOf(eventTicker: string, seriesTicker?: string): string {
  return (seriesTicker ?? eventTicker.split("-")[0]).toUpperCase();
}

/** Fee coefficient for a series. Live tickers carry a "KX" prefix (KXINX) that the fee schedule omits (INX). */
export function feeCoeffFor(series: string): number {
  return KALSHI_SERIES_COEFF[series] ?? KALSHI_SERIES_COEFF[series.replace(/^KX/, "")] ?? KALSHI_DEFAULT_COEFF;
}

/** A quote of 0 means "nobody is bidding/offering" on Kalshi, not a free contract. */
function quote(x: string | undefined): number | null {
  const v = num(x);
  return v === null || v <= 0 || v >= 1 ? null : v;
}

export function normalizeKalshiMarket(ev: KalshiEventRaw, m: KalshiMarketRaw): BinaryMarket | null {
  if (m.market_type && m.market_type !== "binary") return null;
  if (m.mve_collection_ticker) return null; // multi-leg combos never match a single Polymarket contract
  if (m.status && !["active", "open"].includes(m.status)) return null;
  const series = seriesOf(m.event_ticker ?? ev.event_ticker, ev.series_ticker);
  const subtitle = m.yes_sub_title && m.yes_sub_title !== m.title ? m.yes_sub_title : undefined;
  return {
    venue: "kalshi",
    id: m.ticker,
    eventId: ev.event_ticker,
    eventTitle: ev.title ?? "",
    title: m.title ?? ev.title ?? m.ticker,
    subtitle,
    url: `https://kalshi.com/markets/${series.toLowerCase()}`,
    closeTime: m.close_time ?? m.expected_expiration_time ?? "",
    yesBid: quote(m.yes_bid_dollars),
    yesAsk: quote(m.yes_ask_dollars),
    volume: num(m.volume_fp) ?? 0,
    liquidity: num(m.open_interest_fp) ?? 0,
    fee: { kind: "kalshi", coeff: feeCoeffFor(series) },
    rules: m.rules_primary,
  };
}

export interface FetchResult<T> {
  data: T;
  errors: string[];
}

/** Page through open events. A failed page stops pagination but keeps everything fetched so far. */
export async function fetchKalshiMarkets(
  opts: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<FetchResult<BinaryMarket[]>> {
  const out: BinaryMarket[] = [];
  const errors: string[] = [];
  let cursor: string | undefined;
  const maxPages = opts.maxPages ?? 40;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ status: "open", with_nested_markets: "true", limit: "200" });
    if (cursor) qs.set("cursor", cursor);
    let data: EventsPage;
    try {
      data = await fetchJson<EventsPage>(`${KALSHI_BASE}/events?${qs}`, { signal: opts.signal });
    } catch (e) {
      errors.push(`Kalshi events page ${page + 1}: ${errorMessage(e)}`);
      break;
    }
    for (const ev of data.events ?? []) {
      for (const m of ev.markets ?? []) {
        const bm = normalizeKalshiMarket(ev, m);
        if (bm) out.push(bm);
      }
    }
    cursor = data.cursor || undefined;
    if (!cursor || !(data.events ?? []).length) break;
    if (page === maxPages - 1) errors.push(`Kalshi pagination cap reached (${maxPages} pages)`);
  }
  return { data: out, errors };
}

/**
 * Kalshi's book only lists bids. A Yes ask at price P is the same order as a
 * No bid at 1 - P, so the Yes ask ladder is the No bid ladder mirrored.
 */
export function kalshiBookFromBids(yesBids: [string, string][], noBids: [string, string][]): Book {
  const mirror = (levels: [string, string][]): Level[] =>
    levels
      .map(([p, s]) => ({ price: round4(1 - Number(p)), size: Number(s) }))
      .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0)
      .sort((a, b) => a.price - b.price);
  return { yesAsks: mirror(noBids), noAsks: mirror(yesBids) };
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

export async function fetchKalshiBook(ticker: string, signal?: AbortSignal): Promise<Book> {
  const data = await fetchJson<OrderbookResponse>(`${KALSHI_BASE}/markets/${encodeURIComponent(ticker)}/orderbook`, {
    signal,
  });
  const ob = data.orderbook_fp ?? {};
  return kalshiBookFromBids(ob.yes_dollars ?? [], ob.no_dollars ?? []);
}

/** Fetch many books; failures are counted, not hidden, so the scan can report missing depth. */
export async function fetchKalshiBooks(
  tickers: string[],
  opts: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<{ books: Map<string, Book>; failed: number }> {
  const books = new Map<string, Book>();
  let failed = 0;
  await mapLimit(tickers, opts.concurrency ?? 8, async (t) => {
    if (opts.signal?.aborted) {
      failed += 1;
      return;
    }
    try {
      books.set(t, await fetchKalshiBook(t, opts.signal));
    } catch {
      failed += 1;
    }
  });
  return { books, failed };
}
