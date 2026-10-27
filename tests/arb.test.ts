import { describe, expect, it } from "vitest";
import { evaluatePair, walkLegs } from "../src/lib/arb";
import type { Book, FeeModel } from "../src/lib/types";

const KALSHI: FeeModel = { kind: "kalshi", coeff: 0.07 };
const POLY_FREE: FeeModel = { kind: "polymarket", rate: 0, exponent: 1 };
const POLY_FEE: FeeModel = { kind: "polymarket", rate: 0.04, exponent: 1 };

describe("walkLegs", () => {
  it("finds no trade when asks sum to more than $1", () => {
    const r = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.55, size: 100 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 100 }], fee: POLY_FREE },
    );
    expect(r.contracts).toBe(0);
    expect(r.profit).toBe(0);
    expect(r.topEdge).toBeLessThan(0);
  });

  it("locks in profit when YES + NO costs less than $1 after fees", () => {
    // 0.40 + 0.50 = 0.90; Kalshi fee on 100 @ 0.40 = ceil(1.68) = $1.68
    const r = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.4, size: 100 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 100 }], fee: POLY_FREE },
    );
    expect(r.contracts).toBe(100);
    expect(r.cost).toBeCloseTo(90, 6);
    expect(r.fees).toBeCloseTo(1.68, 6);
    expect(r.profit).toBeCloseTo(100 - 90 - 1.68, 6);
  });

  it("is limited by the thinner side of the book", () => {
    const r = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.4, size: 30 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 1000 }], fee: POLY_FREE },
    );
    expect(r.contracts).toBe(30);
  });

  it("walks deeper levels only while the marginal unit is still profitable", () => {
    const r = walkLegs(
      "KALSHI_YES+POLY_NO",
      {
        venue: "kalshi",
        side: "YES",
        asks: [
          { price: 0.4, size: 50 },
          { price: 0.45, size: 50 }, // 0.45 + 0.50 + fees ~ 0.967 -> still profitable
          { price: 0.52, size: 50 }, // 0.52 + 0.50 > 1 -> stop
        ],
        fee: KALSHI,
      },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 500 }], fee: POLY_FREE },
    );
    expect(r.contracts).toBe(100);
    expect(r.fills.filter((f) => f.venue === "kalshi").map((f) => f.price)).toEqual([0.4, 0.45]);
  });

  it("ignores ask ordering from the API", () => {
    const sorted = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.4, size: 10 }, { price: 0.42, size: 10 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 50 }], fee: POLY_FREE },
    );
    const reversed = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.42, size: 10 }, { price: 0.4, size: 10 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 50 }], fee: POLY_FREE },
    );
    expect(reversed.profit).toBeCloseTo(sorted.profit, 9);
  });

  it("drops a trade that per-fill fee rounding makes unprofitable", () => {
    // Gross edge 1 cent on 1 contract; Kalshi charges at least 1 cent.
    const r = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.49, size: 1 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 1 }], fee: POLY_FREE },
    );
    expect(r.contracts).toBe(0);
  });

  it("stops before a thin level whose rounded Kalshi fee lowers total profit", () => {
    // Reviewer repro: the 1-contract level at 0.47 adds a full-cent fee for ~1.9c of gross edge minus fee.
    const r = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.4, size: 10 }, { price: 0.47, size: 1 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 10 }, { price: 0.511, size: 50 }], fee: POLY_FREE },
    );
    expect(r.contracts).toBe(10);
    expect(r.profit).toBeCloseTo(0.83, 6);
  });

  it("trades whole contracts only", () => {
    const r = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.4, size: 100 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 7.25 }, { price: 0.51, size: 3 }], fee: POLY_FREE },
    );
    expect(r.fills.every((f) => Number.isInteger(f.size))).toBe(true);
    expect(r.contracts).toBe(10);
  });

  it("charges Polymarket fees when the market has them", () => {
    const free = walkLegs(
      "POLY_YES+KALSHI_NO",
      { venue: "polymarket", side: "YES", asks: [{ price: 0.4, size: 100 }], fee: POLY_FREE },
      { venue: "kalshi", side: "NO", asks: [{ price: 0.5, size: 100 }], fee: KALSHI },
    );
    const paid = walkLegs(
      "POLY_YES+KALSHI_NO",
      { venue: "polymarket", side: "YES", asks: [{ price: 0.4, size: 100 }], fee: POLY_FEE },
      { venue: "kalshi", side: "NO", asks: [{ price: 0.5, size: 100 }], fee: KALSHI },
    );
    expect(paid.fees - free.fees).toBeCloseTo(100 * 0.04 * 0.4 * 0.6, 5);
  });

  it("annualizes return to the close date", () => {
    const r = walkLegs(
      "KALSHI_YES+POLY_NO",
      { venue: "kalshi", side: "YES", asks: [{ price: 0.4, size: 100 }], fee: KALSHI },
      { venue: "polymarket", side: "NO", asks: [{ price: 0.5, size: 100 }], fee: POLY_FREE },
      { daysToClose: 365 },
    );
    expect(r.annualizedReturn).toBeCloseTo(r.profit / (r.cost + r.fees), 6);
  });
});

describe("evaluatePair", () => {
  it("returns the better of the two directions first", () => {
    const kalshi: Book = { yesAsks: [{ price: 0.6, size: 100 }], noAsks: [{ price: 0.42, size: 100 }] };
    const poly: Book = { yesAsks: [{ price: 0.5, size: 100 }], noAsks: [{ price: 0.52, size: 100 }] };
    const [best, other] = evaluatePair(kalshi, KALSHI, poly, POLY_FREE);
    expect(best.direction).toBe("POLY_YES+KALSHI_NO");
    expect(best.profit).toBeGreaterThan(0);
    expect(other.profit).toBe(0);
  });
});
