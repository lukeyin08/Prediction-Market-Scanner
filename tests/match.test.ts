import { describe, expect, it } from "vitest";
import { matchMarkets } from "../src/lib/match";
import { extractFeatures } from "../src/lib/normalize";
import type { BinaryMarket } from "../src/lib/types";

let n = 0;
function market(venue: "kalshi" | "polymarket", eventTitle: string, title: string, close: string, subtitle?: string): BinaryMarket {
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

describe("extractFeatures", () => {
  it("pulls thresholds, years, and direction out of the text", () => {
    const f = extractFeatures("Will Bitcoin be above $100k on December 31, 2026?");
    expect(f.numbers).toEqual([100000]);
    expect(f.years).toEqual([2026]);
    expect(f.direction).toBe("over");
    expect(f.months).toEqual(["december"]);
    expect(f.tokens).toContain("bitcoin");
  });

  it("canonicalizes synonyms across venues", () => {
    const a = extractFeatures("Fed decreases interest rates by 25 bps");
    const b = extractFeatures("Federal Reserve cuts rate 25bp");
    expect(a.tokens).toEqual(expect.arrayContaining(["fed", "cut", "rate", "bps"]));
    expect(b.tokens).toEqual(expect.arrayContaining(["fed", "cut", "rate", "bps"]));
    expect(a.numbers).toEqual([25]);
    expect(b.numbers).toEqual([25]);
  });

  it("parses comma and percent thresholds", () => {
    expect(extractFeatures("CPI above 3.1% in 2026").numbers).toEqual([3.1]);
    expect(extractFeatures("S&P 500 closes above 6,500").numbers).toEqual([500, 6500]);
  });
});

describe("matchMarkets", () => {
  const close = "2026-12-10T19:00:00Z";

  it("matches the same contract phrased differently", () => {
    const k = [market("kalshi", "Fed decision in December 2026?", "Will the Fed cut rates by 25bps?", close, "Cut 25bps")];
    const p = [
      market("polymarket", "Fed decision in December?", "Fed decreases interest rates by 25 bps after December 2026 meeting?", close),
      market("polymarket", "Fed decision in December?", "Fed decreases interest rates by 50+ bps after December 2026 meeting?", close),
    ];
    const pairs = matchMarkets(k, p);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].polymarket.id).toBe(p[0].id);
  });

  it("never matches different numeric thresholds", () => {
    const k = [market("kalshi", "Bitcoin price at year end", "Bitcoin above $100,000 on Dec 31, 2026?", close)];
    const p = [market("polymarket", "Bitcoin price at year end", "Will Bitcoin be above $120k on December 31, 2026?", close)];
    expect(matchMarkets(k, p)).toHaveLength(0);
  });

  it("never matches opposite directions", () => {
    const k = [market("kalshi", "CPI in November", "CPI above 3.0% in November 2026?", close)];
    const p = [market("polymarket", "CPI in November", "CPI below 3.0% in November 2026?", close)];
    expect(matchMarkets(k, p)).toHaveLength(0);
  });

  it("never matches different years", () => {
    const k = [market("kalshi", "Super Bowl champion", "Will the Chiefs win Super Bowl 2027?", "2027-02-08T00:00:00Z")];
    const p = [market("polymarket", "Super Bowl champion", "Will the Chiefs win Super Bowl 2026?", "2027-02-01T00:00:00Z")];
    expect(matchMarkets(k, p)).toHaveLength(0);
  });

  it("never matches a range bucket to a touch threshold", () => {
    const k = [market("kalshi", "Bitcoin price at the end of 2026", "Bitcoin price at the end of 2026", close, "90,000 to 94,999.99")];
    const p = [market("polymarket", "What price will Bitcoin hit in 2026?", "Will Bitcoin reach $90,000 by December 31, 2026?", close, "$90,000")];
    expect(matchMarkets(k, p, { threshold: 0.3 })).toHaveLength(0);
  });

  it("never matches an individual contract to a race among outcomes", () => {
    const k = [market("kalshi", "Which leaders will leave office in 2026?", "Will Vladimir Putin leave President of Russia before Jan 1, 2027?", "2026-12-31T00:00:00Z", "Vladimir Putin")];
    const p = [market("polymarket", "Next leader out before 2027?", "Will Vladimir Putin be the next leader out before 2027?", "2026-12-31T00:00:00Z", "Vladimir Putin")];
    expect(matchMarkets(k, p, { threshold: 0.3 })).toHaveLength(0);
  });

  it("treats inequality qualifiers as part of the threshold", () => {
    const k = [market("kalshi", "Fed decision in Dec 2026?", "Will the Fed cut rates by more than 25bps?", close, "Cut >25bps")];
    const p = [market("polymarket", "Fed decision in December?", "Will the Fed decrease interest rates by 25 bps after the December 2026 meeting?", close, "25 bps decrease")];
    expect(matchMarkets(k, p, { threshold: 0.3 })).toHaveLength(0);
  });

  it("never matches an announcement to the event itself", () => {
    const k = [market("kalshi", "When will Anthropic officially announce an IPO?", "Will Anthropic announce an IPO before Nov 16, 2026?", close, "Before Nov 16, 2026")];
    const p = [market("polymarket", "Anthropic IPO by...?", "Will Anthropic IPO by November 15, 2026?", close, "November 15, 2026")];
    expect(matchMarkets(k, p, { threshold: 0.3 })).toHaveLength(0);
  });

  it("rejects pairs that close far apart", () => {
    const k = [market("kalshi", "Who will win the NYC mayoral race?", "Will Zohran Mamdani win?", "2026-11-04T00:00:00Z")];
    const p = [market("polymarket", "NYC mayoral election", "Will Zohran Mamdani win the NYC mayoral election?", "2027-06-01T00:00:00Z")];
    expect(matchMarkets(k, p)).toHaveLength(0);
  });

  it("flags close-date differences on accepted pairs", () => {
    const k = [market("kalshi", "Who will win the NYC mayoral race?", "Will Zohran Mamdani win?", "2026-11-04T00:00:00Z")];
    const p = [market("polymarket", "NYC mayoral election", "Will Zohran Mamdani win the NYC mayoral election?", "2026-11-20T00:00:00Z")];
    const pairs = matchMarkets(k, p);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].flags.join(" ")).toMatch(/Close dates differ/);
  });

  it("keeps only mutual best matches", () => {
    // Both venues label each outcome inside a multi-outcome event (yes_sub_title / groupItemTitle).
    const k = [
      market("kalshi", "NBA Finals 2027 winner", "Will Boston win the 2027 NBA Finals?", "2027-06-20T00:00:00Z", "Boston Celtics"),
      market("kalshi", "NBA Finals 2027 winner", "Will Oklahoma City win the 2027 NBA Finals?", "2027-06-20T00:00:00Z", "Oklahoma City Thunder"),
    ];
    const p = [
      market("polymarket", "2027 NBA Champion", "Will the Boston Celtics win the 2027 NBA Finals?", "2027-06-25T00:00:00Z", "Boston Celtics"),
      market("polymarket", "2027 NBA Champion", "Will the Oklahoma City Thunder win the 2027 NBA Finals?", "2027-06-25T00:00:00Z", "Oklahoma City Thunder"),
    ];
    const pairs = matchMarkets(k, p);
    expect(pairs).toHaveLength(2);
    for (const pair of pairs) {
      const team = pair.kalshi.subtitle!.includes("Celtics") ? "Celtics" : "Thunder";
      expect(pair.polymarket.title).toContain(team);
    }
  });
});
