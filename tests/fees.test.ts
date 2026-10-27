import { describe, expect, it } from "vitest";
import { kalshiFee, marginalFee, polymarketFee } from "../src/lib/fees";

describe("kalshiFee", () => {
  it("matches the published example: 100 contracts at 50c pays $1.75", () => {
    expect(kalshiFee(100, 0.5)).toBe(1.75);
  });

  it("rounds up to the next cent per fill", () => {
    // 0.07 * 1 * 0.5 * 0.5 = 0.0175 -> 0.02
    expect(kalshiFee(1, 0.5)).toBe(0.02);
    // 0.07 * 10 * 0.3 * 0.7 = 0.147 -> 0.15
    expect(kalshiFee(10, 0.3)).toBe(0.15);
  });

  it("does not round an exact cent up", () => {
    // 0.07 * 400 * 0.5 * 0.5 = 7.00 exactly
    expect(kalshiFee(400, 0.5)).toBe(7);
  });

  it("is symmetric around 50c and smallest at the extremes", () => {
    expect(kalshiFee(100, 0.2)).toBe(kalshiFee(100, 0.8));
    expect(kalshiFee(100, 0.02)).toBeLessThan(kalshiFee(100, 0.5));
  });

  it("supports reduced-coefficient products", () => {
    expect(kalshiFee(100, 0.5, 0.035)).toBe(0.88);
  });
});

describe("polymarketFee", () => {
  it("is zero for fee-free markets", () => {
    expect(polymarketFee(1000, 0.5, 0)).toBe(0);
  });

  it("uses C * rate * p * (1 - p) rounded to 5 dp", () => {
    // 100 * 0.04 * 0.25 = 1.0
    expect(polymarketFee(100, 0.5, 0.04)).toBe(1);
    // 3 * 0.07 * 0.2 * 0.8 = 0.0336
    expect(polymarketFee(3, 0.2, 0.07)).toBe(0.0336);
  });
});

describe("marginalFee", () => {
  it("is the unrounded per-contract fee", () => {
    expect(marginalFee({ kind: "kalshi", coeff: 0.07 }, 0.5)).toBeCloseTo(0.0175, 10);
    expect(marginalFee({ kind: "polymarket", rate: 0.04, exponent: 1 }, 0.5)).toBeCloseTo(0.01, 10);
  });
});
