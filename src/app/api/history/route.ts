import { SNAPSHOT_BASE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  let res: Response;
  try {
    res = await fetch(`${SNAPSHOT_BASE_URL}/analysis.json`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch {
    return Response.json({ error: "Couldn't reach the snapshot store. Try again shortly." }, { status: 502 });
  }
  if (res.status === 404) {
    return Response.json({ error: "No history yet. The snapshot job runs every 30 minutes." }, { status: 404 });
  }
  try {
    const data = await res.json();
    if (!res.ok || typeof data?.scans !== "number" || !data.summary || !Array.isArray(data.episodes)) throw new Error();
    return Response.json(data, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" } });
  } catch {
    return Response.json({ error: "History data is unavailable or malformed." }, { status: 502 });
  }
}
