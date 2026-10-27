import { runScan } from "@/lib/scan";
import { SNAPSHOT_BASE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE = "public, s-maxage=120, stale-while-revalidate=600";

/**
 * GET /api/scan           live scan (cached at the edge for 2 minutes)
 * GET /api/scan?source=latest   most recent scheduled snapshot from the data branch
 */
export async function GET(req: Request) {
  const source = new URL(req.url).searchParams.get("source");

  if (source !== "latest") {
    try {
      const scan = await runScan();
      if (scan.stats.matchedPairs > 0 || !scan.errors.length) {
        return Response.json(scan, { headers: { "cache-control": CACHE } });
      }
    } catch {
      // fall through to the last scheduled snapshot
    }
  }

  try {
    const res = await fetch(`${SNAPSHOT_BASE_URL}/latest.json`, { cache: "no-store" });
    if (res.ok) {
      const scan = await res.json();
      return Response.json({ ...scan, fromSnapshot: true }, { headers: { "cache-control": CACHE } });
    }
  } catch {
    // ignore
  }
  return Response.json({ error: "Scan failed and no snapshot is available yet." }, { status: 502 });
}
