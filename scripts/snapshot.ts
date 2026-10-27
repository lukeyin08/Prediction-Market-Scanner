/**
 * Run a scan and append a compact snapshot to <out>/YYYY-MM-DD.jsonl.
 * Run on a schedule by .github/workflows/snapshot.yml.
 *   npm run snapshot -- --out data/snapshots
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toSnapshot } from "../src/lib/history";
import { runScan } from "../src/lib/scan";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const outDir = arg("out", "data/snapshots");
  const scan = await runScan();
  const snap = toSnapshot(scan);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${snap.t.slice(0, 10)}.jsonl`);
  appendFileSync(file, JSON.stringify(snap) + "\n");
  writeFileSync(join(outDir, "..", "latest.json"), JSON.stringify(scan));
  console.log(
    `${snap.t}: ${scan.stats.matchedPairs} pairs, ${scan.stats.opportunities} opportunities -> ${file}` +
      (scan.errors.length ? `\nerrors: ${scan.errors.join("; ")}` : ""),
  );
  if (scan.errors.length && !scan.stats.matchedPairs) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
