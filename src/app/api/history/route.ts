import { SNAPSHOT_BASE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${SNAPSHOT_BASE_URL}/analysis.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return Response.json(await res.json(), {
      headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" },
    });
  } catch {
    return Response.json({ error: "No history yet. The snapshot job runs every 30 minutes." }, { status: 404 });
  }
}
