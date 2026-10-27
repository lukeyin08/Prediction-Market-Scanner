import type { FeeModel } from "./types";

/** Kalshi's general trading fee coefficient. Some index products use a lower one. */
export const KALSHI_DEFAULT_COEFF = 0.07;

/** Series with a published coefficient that differs from the default. */
export const KALSHI_SERIES_COEFF: Record<string, number> = {
  INX: 0.035,
  INXD: 0.035,
  NASDAQ100: 0.035,
  NASDAQ100D: 0.035,
};

const EPS = 1e-9;

function variance(price: number): number {
  return Math.max(0, price * (1 - price));
}

/**
 * Exact Kalshi fee for one fill: 0.07 * C * P * (1 - P), rounded UP to the next cent.
 * Rounding happens per fill, which is why tiny orders pay a full cent.
 */
export function kalshiFee(contracts: number, price: number, coeff = KALSHI_DEFAULT_COEFF): number {
  if (contracts <= 0) return 0;
  const raw = coeff * contracts * variance(price);
  return Math.ceil(raw * 100 - EPS) / 100;
}

/** Exact Polymarket taker fee for one fill: C * rate * (P * (1 - P))^exponent, rounded to 5 dp. */
export function polymarketFee(contracts: number, price: number, rate: number, exponent = 1): number {
  if (contracts <= 0 || rate <= 0) return 0;
  const raw = contracts * rate * Math.pow(variance(price), exponent);
  return Math.round(raw * 1e5) / 1e5;
}

export function feeFor(model: FeeModel, contracts: number, price: number): number {
  return model.kind === "kalshi"
    ? kalshiFee(contracts, price, model.coeff)
    : polymarketFee(contracts, price, model.rate, model.exponent);
}

/** Unrounded fee per contract. Used for marginal decisions while walking the book. */
export function marginalFee(model: FeeModel, price: number): number {
  return model.kind === "kalshi"
    ? model.coeff * variance(price)
    : model.rate * Math.pow(variance(price), model.exponent);
}
