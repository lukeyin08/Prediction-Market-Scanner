export const cents = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(1)}¢`);

export const usd = (x: number | null | undefined, dp = 2) =>
  x === null || x === undefined
    ? "–"
    : x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });

export const pct = (x: number | null | undefined, dp = 1) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(dp)}%`);

export const pts = (x: number | null | undefined) =>
  x === null || x === undefined ? "–" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)} pts`;

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function minutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return "–";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} d`;
}

export const DIRECTION_LABEL: Record<string, string> = {
  "KALSHI_YES+POLY_NO": "Buy YES on Kalshi + NO on Polymarket",
  "POLY_YES+KALSHI_NO": "Buy YES on Polymarket + NO on Kalshi",
};
