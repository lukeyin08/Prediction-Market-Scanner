import { marginalFee } from "@/lib/fees";
import type { PairResult } from "@/lib/types";

export interface Leg {
  venue: "kalshi" | "polymarket";
  side: "YES" | "NO";
  price: number;
}

/** What one YES + one NO pair costs, split into its parts, per $1 of payout. */
export interface Breakdown {
  legs: Leg[];
  fee: number;
  edge: number;
  /** True when computed from executed fills; false when estimated from quotes. */
  exact: boolean;
}

export function breakdown(p: PairResult): Breakdown | null {
  const best = p.best;
  if (best && best.contracts > 0 && best.fills.length) {
    const byLeg = new Map<string, { venue: Leg["venue"]; side: Leg["side"]; cost: number; size: number }>();
    for (const f of best.fills) {
      const key = `${f.venue}|${f.side}`;
      const leg = byLeg.get(key) ?? { venue: f.venue, side: f.side, cost: 0, size: 0 };
      leg.cost += f.price * f.size;
      leg.size += f.size;
      byLeg.set(key, leg);
    }
    const legs = [...byLeg.values()].map((l) => ({ venue: l.venue, side: l.side, price: l.cost / l.size }));
    return { legs, fee: best.fees / best.contracts, edge: best.profit / best.contracts, exact: true };
  }

  // No executable trade. Use the scanner's book-based edge for the closer
  // direction; leg prices come from top-of-book quotes, with the second leg
  // set so the bar adds up to that edge.
  const k = p.kalshi;
  const pm = p.polymarket;
  const alt = p.alternatives
    .filter((a) => a.topEdge !== null)
    .sort((a, b) => (b.topEdge ?? -Infinity) - (a.topEdge ?? -Infinity))[0];
  if (!alt || alt.topEdge === null) return null;
  const kalshiYes = alt.direction === "KALSHI_YES+POLY_NO";
  const first: Leg | null = kalshiYes
    ? k.yesAsk !== null
      ? { venue: "kalshi", side: "YES", price: k.yesAsk }
      : null
    : pm.yesAsk !== null
      ? { venue: "polymarket", side: "YES", price: pm.yesAsk }
      : null;
  if (!first) return null;
  const firstFee = marginalFee(kalshiYes ? k.fee : pm.fee, first.price);
  // Solve for the second leg's price p2 so that 1 - p1 - p2 - fee1 - fee2(p2) = edge.
  const secondFeeModel = kalshiYes ? pm.fee : k.fee;
  let p2 = 1 - first.price - firstFee - alt.topEdge;
  for (let i = 0; i < 4; i++) p2 = 1 - first.price - firstFee - marginalFee(secondFeeModel, p2) - alt.topEdge;
  const second: Leg = { venue: kalshiYes ? "polymarket" : "kalshi", side: "NO", price: Math.min(Math.max(p2, 0), 1) };
  const fee = firstFee + marginalFee(secondFeeModel, second.price);
  return { legs: [first, second], fee, edge: alt.topEdge, exact: false };
}

const VENUE = { kalshi: "Kalshi", polymarket: "Polymarket" } as const;
export const legLabel = (l: Leg) => `${l.side} on ${VENUE[l.venue]}`;

/**
 * A bar for $1 of payout: the two legs, fees, and what's left. If the pair
 * costs more than $1, the bar runs past the $1 mark and the overrun is hatched.
 */
export function DollarBar({ b, size }: { b: Breakdown; size: "hero" | "mini" }) {
  const cost = b.legs[0].price + b.legs[1].price + b.fee;
  const scale = Math.max(1, cost);
  const pct = (x: number) => `${(Math.max(0, x) / scale) * 100}%`;
  const parts: { cls: string; w: number; title: string }[] = [
    ...b.legs.map((l) => ({
      cls: l.venue === "kalshi" ? "kalshi" : "poly",
      w: l.price,
      title: `${legLabel(l)}: ${(l.price * 100).toFixed(1)}¢`,
    })),
    { cls: "fee", w: b.fee, title: `Fees: ${(b.fee * 100).toFixed(2)}¢` },
  ];
  if (b.edge > 0) parts.push({ cls: "edge", w: b.edge, title: `Left over: ${(b.edge * 100).toFixed(2)}¢` });

  return (
    <div
      className={size === "hero" ? "dollar" : "mini"}
      role="img"
      aria-label={`${parts.map((p) => p.title).join(", ")}. ${cost <= 1 ? "Costs less than $1." : "Costs more than $1."}`}
    >
      {parts.map((p, i) => (
        <span key={i} className={`seg ${p.cls}`} style={{ width: pct(p.w) }} title={p.title} />
      ))}
      {cost > 1 && (
        <span
          className="seg over"
          aria-hidden
          style={{ position: "absolute", left: pct(1), width: pct(cost - 1), top: 0, bottom: 0, margin: 0 }}
        />
      )}
      <span className="par" aria-hidden style={{ left: pct(1) }} />
    </div>
  );
}

/**
 * A short name for the outcome being traded. Kalshi's outcome label is ideal
 * ("María Corina Machado", "Cut 25bps") unless it's only a deadline or Yes,
 * in which case the question itself is the clearer headline.
 */
export function headline(p: PairResult): { title: string; context: string } {
  const label = p.kalshi.subtitle ?? p.polymarket.subtitle;
  const generic = !label || /^(before|by|in|on|after|until|yes|no)\b/i.test(label) || /^\d{4}$/.test(label.trim());
  if (!generic) return { title: label!, context: p.kalshi.eventTitle || p.polymarket.title };
  return { title: p.polymarket.title || p.kalshi.title, context: label ? `Kalshi: ${p.kalshi.eventTitle} (${label})` : p.kalshi.title };
}
