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
 * GET /api/scan
 *
 * Serves the latest scheduled snapshot (a full-coverage scan runs every 30
 * minutes in GitHub Actions and takes ~2 minutes, longer than a serverless
 * request should). Only if no snapshot exists does it attempt a time-boxed
 * live scan. Any query string redirects to the bare URL so the CDN cache
 * can't be bypassed.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.search) {
    return Response.redirect(new URL(url.pathname, url.origin), 308);
  }

  const snapshot = await loadSnapshot();
  if (snapshot) {
    return Response.json(slim(snapshot), { headers: { "cache-control": CACHE } });
  }

  try {
    const live = await runScan({ deadlineMs: SCAN_DEADLINE_MS, maxPairs: 150 });
    if (live.stats.matchedPairs > 0) {
      const note = live.complete ? [] : ["Live scan was time-boxed and may be partial."];
      return Response.json(slim({ ...live, warnings: [...(live.warnings ?? []), ...note] }), {
        headers: { "cache-control": "public, s-maxage=60" },
      });
    }
  } catch {
    // fall through
  }
  return Response.json({ error: "No snapshot is available yet and the live scan failed." }, { status: 502 });
}
