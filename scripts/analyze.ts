/**
 * Read every snapshot and measure how long cross-venue arbitrage survives.
 *   npm run analyze -- --dir data/snapshots --out data/analysis.json
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, type Snapshot } from "../src/lib/history";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = arg("dir", "data/snapshots");
const out = arg("out", "data/analysis.json");

const snapshots: Snapshot[] = [];
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        snapshots.push(JSON.parse(line));
      } catch {
        // skip a torn line from an interrupted run
      }
    }
  }
}

const result = analyze(snapshots);
writeFileSync(out, JSON.stringify(result, null, 2));
const s = result.summary;
console.log(
  `${result.scans} scans, ${s.pairsSeen} pairs seen, ${s.pairsEverArbitrageable} ever arbitrageable, ` +
    `${s.episodes} episodes (median ${s.medianDurationMin?.toFixed(0) ?? "-"} min) -> ${out}`,
);
