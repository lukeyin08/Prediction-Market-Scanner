/**
 * Run the matcher over a market dump and print every accepted pair for review.
 *   gh workflow run dump-markets.yml   # publishes markets.json.gz to the fixtures branch
 *   git fetch origin fixtures && git show origin/fixtures:markets.json.gz | gunzip > markets.json
 *   npm run eval -- markets.json [threshold]
 */
import { readFileSync } from "node:fs";
import { matchMarkets } from "../src/lib/match";

const [file = "markets.json", threshold] = process.argv.slice(2);
const dump = JSON.parse(readFileSync(file, "utf8"));
const started = Date.now();
const pairs = matchMarkets(dump.kalshi, dump.poly, threshold ? { threshold: Number(threshold) } : {});
console.log(
  `${dump.kalshi.length} Kalshi x ${dump.poly.length} Polymarket contracts (${dump.generatedAt}) -> ` +
    `${pairs.length} pairs in ${Date.now() - started}ms\n`,
);
for (const p of pairs) {
  const k = p.kalshi.subtitle ? `${p.kalshi.eventTitle} :: ${p.kalshi.subtitle}` : p.kalshi.title;
  const flags = p.flags.length ? `  [${p.flags.join("; ")}]` : "";
  console.log(`${p.score.toFixed(2)}  ${k}\n      <> ${p.polymarket.title}${flags}`);
}
