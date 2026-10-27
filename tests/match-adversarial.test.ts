/**
 * Regression cases from an adversarial review of the matcher. Each "rejects"
 * case is a pair that shares almost all its wording but pays off differently;
 * they run at a low threshold to prove the rejection is a hard rule, not a
 * score that happens to fall short.
 */
import { describe, expect, it } from "vitest";
import { matchMarkets } from "../src/lib/match";
import { extractFeatures } from "../src/lib/normalize";
import type { BinaryMarket } from "../src/lib/types";

let n = 0;
function m(venue: "kalshi" | "polymarket", eventTitle: string, title: string, close: string, subtitle?: string): BinaryMarket {
  n += 1;
  return {
    venue,
    id: `${venue}-${n}`,
    eventId: `ev-${n}`,
    eventTitle,
    title,
    subtitle,
    url: "",
    closeTime: close,
    yesBid: 0.4,
    yesAsk: 0.42,
    volume: 1000,
    liquidity: 1000,
    fee: venue === "kalshi" ? { kind: "kalshi", coeff: 0.07 } : { kind: "polymarket", rate: 0, exponent: 1 },
  };
}

const LOW = { threshold: 0.3 };
const DEC = "2026-12-10T19:00:00Z";
const OCT = "2026-10-29T18:00:00Z";

describe("matcher rejects look-alike contracts", () => {
  it("different Fed meeting month", () => {
    const k = [m("kalshi", "Fed decision in Dec 2026?", "Will the Fed cut rates by 25bps?", DEC, "Cut 25bps")];
    const p = [m("polymarket", "Fed decision in October?", "Will the Fed decrease interest rates by 25 bps after the October 2026 meeting?", OCT)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("different day in a daily series", () => {
    const k = [m("kalshi", "Russia strikes on Kyiv", "Will Russia target Kyiv on Oct 29, 2026?", OCT)];
    const p = [m("polymarket", "Russia x Kyiv strikes", "Will Russia target Kyiv on October 30, 2026?", OCT)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("different week in a counting series", () => {
    const k = [m("kalshi", "Musk tweets", "Will Elon Musk post 40-64 tweets from Oct 24 to Oct 26?", OCT)];
    const p = [m("polymarket", "Elon Musk # of tweets", "Will Elon Musk post 40-64 tweets from October 26 to October 28?", OCT)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("'decision' is not the month December", () => {
    expect(extractFeatures("Fed decision: 25 bps cut").numbers).toEqual([25]);
    const k = [m("kalshi", "Fed decision: 25 bps cut in December 2026?", "Fed decision: 25 bps cut in December 2026?", DEC)];
    const p = [m("polymarket", "Fed decision: 50 bps cut in December 2026?", "Fed decision: 50 bps cut in December 2026?", DEC)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("swapped single-letter party labels", () => {
    const k = [m("kalshi", "2026 Balance of Power", "2026 Balance of Power: D Senate, R House", DEC, "D Senate, R House")];
    const p = [m("polymarket", "2026 Balance of Power", "2026 Balance of Power: R Senate, D House", DEC, "R Senate, D House")];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("negation", () => {
    const k = [m("kalshi", "Iran Supreme Leader", "Will Iran have no Supreme Leader on Dec 31, 2026?", DEC)];
    const p = [m("polymarket", "Iran Supreme Leader", "Will Iran have a Supreme Leader on Dec 31, 2026?", DEC)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("touch by a date vs level on a date", () => {
    const k = [m("kalshi", "Bitcoin", "Will Bitcoin be above $150,000 by Dec 31, 2026?", DEC)];
    const p = [m("polymarket", "Bitcoin", "Will Bitcoin be above $150,000 on Dec 31, 2026?", DEC)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("threshold with an unclassified path vs a terminal one", () => {
    const k = [m("kalshi", "Ethereum", "Will Ethereum be above $5,000 in 2026?", DEC)];
    const p = [m("polymarket", "Ethereum", "Will Ethereum be above $5,000 at year-end 2026?", DEC)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("resolution-defining words: votes vs seats, nominee vs winner, coding", () => {
    const pairs: [string, string][] = [
      ["Which party will win the most votes in the 2026 Ohio election?", "Which party will win the most seats in the 2026 Ohio election?"],
      ["Will Jane Doe be the Democratic nominee for Ohio governor in 2026?", "Will Jane Doe win the Ohio governor election in 2026?"],
      ["Will Google have the best coding model at the end of 2026?", "Will Google have the best AI model at the end of 2026?"],
    ];
    for (const [a, b] of pairs) {
      expect(matchMarkets([m("kalshi", a, a, DEC)], [m("polymarket", b, b, DEC)], LOW)).toHaveLength(0);
    }
  });

  it("Q3 vs Q4 and partial numeric overlap", () => {
    expect(extractFeatures("Q3 GDP above 2%").numbers).toEqual([2]);
    const k = [m("kalshi", "US GDP", "Will Q3 GDP growth be above 2%?", DEC)];
    const p = [m("polymarket", "US GDP", "Will Q4 GDP growth be above 2%?", DEC)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("a dated contract vs an undated one", () => {
    const k = [m("kalshi", "Will Shrek 5 be delayed?", "Will Shrek 5 be delayed?", DEC, "Before Jul 1, 2027")];
    const p = [m("polymarket", "Will Shrek 5 be delayed?", "Will Shrek 5 be delayed?", DEC)];
    expect(matchMarkets(k, p, LOW)).toHaveLength(0);
  });

  it("clock times are not thresholds", () => {
    expect(extractFeatures("Bitcoin above $100,000 at 11:59 PM ET on Dec 31").numbers).toEqual([100000]);
    expect(extractFeatures("Settles at 12:00am").numbers).toEqual([]);
  });
});

describe("matcher accepts equivalent contracts written differently", () => {
  it("'before Jan 1, 2027' equals 'by December 31, 2026'", () => {
    const a = extractFeatures("Will France declare a state of emergency before Jan 1, 2027?");
    const b = extractFeatures("France declares state of emergency by December 31, 2026?");
    expect(a.dates).toEqual(b.dates);
    expect(a.years).toEqual(b.years);
    const k = [m("kalshi", "Will France declare a state of emergency?", "Will France declare a state of emergency before Jan 1, 2027?", DEC, "Before Jan 1, 2027")];
    const p = [m("polymarket", "France state of emergency by...?", "France declares state of emergency by December 31, 2026?", DEC, "December 31")];
    expect(matchMarkets(k, p)).toHaveLength(1);
  });

  it("season labels are years, not a numeric range", () => {
    const f = extractFeatures("Will Aston Villa win the 2026-27 UEFA Champions League?");
    expect(f.shape.range).toBe(false);
    expect(f.years).toEqual([2026, 2027]);
    const k = [m("kalshi", "Champions League Winner", "Will Aston Villa win the Champions League?", "2027-05-29T00:00:00Z", "Aston Villa")];
    const p = [m("polymarket", "UEFA Champions League Winner", "Will Aston Villa win the 2026-27 UEFA Champions League Championship?", "2027-05-30T00:00:00Z", "Aston Villa")];
    expect(matchMarkets(k, p)).toHaveLength(1);
  });

  it("'before 2027' is a deadline, not a race", () => {
    expect(extractFeatures("Will the US confirm that aliens exist before 2027?").shape.race).toBe(false);
    expect(extractFeatures("Will Bitcoin hit $50k before $100k?").shape.race).toBe(true);
    expect(extractFeatures("Next leader out before 2027?").shape.race).toBe(true);
  });

  it("bucket edges like $99,999.99 snap to the round number", () => {
    expect(extractFeatures("Bitcoin above $99,999.99").numbers).toEqual([100000]);
  });

  it("'maintains rate' reads as a hold", () => {
    expect(extractFeatures("Fed maintains rate").tokens).toContain("hold");
  });
});
