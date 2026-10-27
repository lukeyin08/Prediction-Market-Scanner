import { describe, expect, it } from "vitest";
import { kalshiBookFromBids, normalizeKalshiMarket } from "../src/lib/kalshi";
import { normalizePolyMarket, polyFeeModel, toAsks } from "../src/lib/polymarket";

describe("Kalshi parsing", () => {
  it("mirrors bids into ask ladders (Yes ask = 1 - No bid)", () => {
    // Example from Kalshi's docs.
    const book = kalshiBookFromBids(
      [
        ["0.4100", "10.00"],
        ["0.4200", "13.00"],
      ],
      [
        ["0.4400", "29.00"],
        ["0.5600", "17.00"],
      ],
    );
    expect(book.yesAsks[0]).toEqual({ price: 0.44, size: 17 });
    expect(book.yesAsks[1]).toEqual({ price: 0.56, size: 29 });
    expect(book.noAsks[0]).toEqual({ price: 0.58, size: 13 });
  });

  it("normalizes dollar-string quotes and treats 0 as no quote", () => {
    const m = normalizeKalshiMarket(
      { event_ticker: "KXFEDDECISION-26DEC", series_ticker: "KXFEDDECISION", title: "Fed decision in December 2026?" },
      {
        ticker: "KXFEDDECISION-26DEC-C25",
        event_ticker: "KXFEDDECISION-26DEC",
        market_type: "binary",
        status: "active",
        title: "Will the Fed cut by 25bps?",
        yes_sub_title: "Cut 25bps",
        close_time: "2026-12-09T18:55:00Z",
        yes_bid_dollars: "0.6100",
        yes_ask_dollars: "0.0000",
        volume_fp: "1520.00",
        open_interest_fp: "800.00",
      },
    );
    expect(m).not.toBeNull();
    expect(m!.yesBid).toBe(0.61);
    expect(m!.yesAsk).toBeNull();
    expect(m!.subtitle).toBe("Cut 25bps");
    expect(m!.url).toBe("https://kalshi.com/markets/kxfeddecision");
  });

  it("skips multi-leg combo markets", () => {
    const m = normalizeKalshiMarket(
      { event_ticker: "KXMVE-1" },
      { ticker: "KXMVE-1-A", event_ticker: "KXMVE-1", market_type: "binary", mve_collection_ticker: "KXMVE-R" },
    );
    expect(m).toBeNull();
  });
});

describe("Polymarket parsing", () => {
  const raw = {
    conditionId: "0xabc",
    question: "Xi Jinping out before 2027?",
    outcomes: '["Yes", "No"]',
    clobTokenIds: '["111", "222"]',
    bestBid: 0.038,
    bestAsk: 0.039,
    endDate: "2027-01-01T04:59:00Z",
    liquidityNum: 320310,
    volumeNum: 16221204,
    active: true,
    closed: false,
    feesEnabled: true,
    feeType: "zero_fees",
    feeSchedule: { exponent: 1, rate: 0, takerOnly: true },
  };

  it("decodes JSON-encoded string arrays", () => {
    const m = normalizePolyMarket({ id: "30828", title: "Xi out?", slug: "xi-out" }, raw);
    expect(m!.yesTokenId).toBe("111");
    expect(m!.noTokenId).toBe("222");
    expect(m!.url).toBe("https://polymarket.com/event/xi-out");
  });

  it("reads zero-fee markets as free and fee markets from feeSchedule", () => {
    expect(polyFeeModel(raw)).toEqual({ kind: "polymarket", rate: 0, exponent: 1 });
    expect(polyFeeModel({ ...raw, feeType: "taker", feeSchedule: { rate: 0.04, exponent: 1 } })).toEqual({
      kind: "polymarket",
      rate: 0.04,
      exponent: 1,
    });
  });

  it("skips non Yes/No markets", () => {
    expect(normalizePolyMarket({ id: "1" }, { ...raw, outcomes: '["Up", "Down"]' })).toBeNull();
  });

  it("sorts asks ascending regardless of API order", () => {
    expect(
      toAsks([
        { price: "0.55", size: "10" },
        { price: "0.52", size: "5" },
      ]).map((l) => l.price),
    ).toEqual([0.52, 0.55]);
  });
});
