import { SNAPSHOT_BASE_URL } from "@/lib/config";
import { runScan } from "@/lib/scan";
import type { PairResult, ScanResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leave headroom under maxDuration for the snapshot fallback and response. */
const SCAN_DEADLINE_MS = 40_000;
const CACHE = "public, s-maxage=120, stale-while-revalidate=600";

function isScanResult(x: unknown): x is ScanResult {
  const s = x as ScanResult;
  return (
    !!s &&
    typeof s.generatedAt === "string" &&
    !!s.stats &&
    typeof s.stats.matchedPairs === "number" &&
    typeof s.stats.durationMs === "number" &&
    Array.isArray(s.pairs) &&
    Array.isArray(s.errors)
  );
}

/** Drop what the dashboard never shows (rules text, losing directions' fills). */
function slim(scan: ScanResult): ScanResult {
  const strip = (p: PairResult): PairResult => ({
    ...p,
    kalshi: { ...p.kalshi, rules: undefined },
    polymarket: { ...p.polymarket, rules: undefined },
    alternatives: p.alternatives.map((a) => (a === p.best ? a : { ...a, fills: [] })),
  });
  return { ...scan, pairs: scan.pairs.map(strip) };
}

async function loadSnapshot(): Promise<ScanResult | null> {
  try {
    const res = await fetch(`${SNAPSHOT_BASE_URL}/latest.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return isScanResult(data) ? { ...data, fromSnapshot: true } : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/scan   live scan, cached at the edge for 2 minutes.
 *
 * Any query string redirects to the bare URL so the CDN cache can't be
 * bypassed (each uncached request would run ~200 upstream calls). A scan that
 * is incomplete or runs out of time falls back to the last scheduled snapshot.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.search) {
    return Response.redirect(new URL(url.pathname, url.origin), 308);
  }

  let live: ScanResult | null = null;
  try {
    live = await runScan({ deadlineMs: SCAN_DEADLINE_MS });
    if (live.complete && live.stats.matchedPairs > 0) {
      return Response.json(slim(live), { headers: { "cache-control": CACHE } });
    }
  } catch {
    live = null;
  }

  const snapshot = await loadSnapshot();
  if (snapshot) {
    const note = live ? [`Live scan incomplete (${live.errors.join("; ") || "no pairs"}); showing last snapshot.`] : [];
    return Response.json(slim({ ...snapshot, errors: [...note, ...snapshot.errors] }), {
      headers: { "cache-control": CACHE },
    });
  }
  if (live && live.stats.matchedPairs > 0) {
    // Partial live data beats nothing; cache briefly.
    return Response.json(slim(live), { headers: { "cache-control": "public, s-maxage=30" } });
  }
  return Response.json({ error: "Live scan failed and no snapshot is available yet." }, { status: 502 });
}
