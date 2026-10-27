/**
 * Dump every live, liquid contract from both venues (normalized) to JSON.
 * Used to build fixtures for evaluating the matcher offline.
 *   npm run dump -- --out fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchKalshiMarkets } from "../src/lib/kalshi";
import { fetchPolymarketMarkets } from "../src/lib/polymarket";
import { liveFilter } from "../src/lib/scan";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const out = arg("out", "fixtures");
  const now = Date.now();
  const [kRes, pRes] = await Promise.all([fetchKalshiMarkets(), fetchPolymarketMarkets()]);
  for (const e of [...kRes.errors, ...pRes.errors, ...kRes.warnings, ...pRes.warnings]) console.error(e);
  const k = kRes.data;
  const p = pRes.data;
  const kalshi = liveFilter(k, now, 400, 50);
  const poly = liveFilter(p, now, 400, 50);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "markets.json"), JSON.stringify({ generatedAt: new Date(now).toISOString(), kalshi, poly }));
  console.log(`kalshi ${k.length} -> ${kalshi.length} live; polymarket ${p.length} -> ${poly.length} live`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
