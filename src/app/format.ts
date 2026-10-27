const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

export const cents = (x: number | null | undefined) => (ok(x) ? `${(x * 100).toFixed(1)}¢` : "–");

export const usd = (x: number | null | undefined, dp = 2) =>
  ok(x)
    ? x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp })
    : "–";

export const pct = (x: number | null | undefined, dp = 1) => (ok(x) ? `${(x * 100).toFixed(dp)}%` : "–");

export const pts = (x: number | null | undefined) => (ok(x) ? `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)} pts` : "–");

export function shortDate(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "–";
}

/** Earlier of two ISO timestamps, ignoring unparseable ones. */
export function earliestClose(a: string | null | undefined, b: string | null | undefined): string | null {
  const times = [a, b].map((x) => (x ? Date.parse(x) : NaN)).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

export function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "at an unknown time";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function minutes(m: number | null | undefined): string {
  if (!ok(m)) return "–";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
}

export const DIRECTION_LABEL: Record<string, string> = {
  "KALSHI_YES+POLY_NO": "Buy YES on Kalshi + NO on Polymarket",
  "POLY_YES+KALSHI_NO": "Buy YES on Polymarket + NO on Kalshi",
};
