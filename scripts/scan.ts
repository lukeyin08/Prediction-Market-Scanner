/**
 * One-off scan printed to the terminal.
 *   npm run scan            # top opportunities and divergences
 *   npm run scan -- --json  # full JSON
 */
import { runScan } from "../src/lib/scan";

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "  -  " : `${(x * 100).toFixed(1)}`);

async function main() {
  const scan = await runScan();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }
  const s = scan.stats;
  console.log(
    `Scanned ${s.kalshiMarkets} Kalshi + ${s.polymarketMarkets} Polymarket contracts in ${(s.durationMs / 1000).toFixed(1)}s`,
  );
  console.log(`Matched ${s.matchedPairs} pairs, ${s.opportunities} with positive edge after fees ($${s.executableProfit} executable)\n`);
  for (const e of scan.errors) console.log(`! ${e}`);

  for (const p of scan.pairs.slice(0, 25)) {
    const b = p.best;
    console.log(
      [
        p.score.toFixed(2),
        `K ${pct(p.kalshiMid)}`,
        `P ${pct(p.polyMid)}`,
        b ? `+$${b.profit.toFixed(2)} on ${b.contracts} (${b.direction})` : "no arb",
        `| ${p.kalshi.subtitle ? `${p.kalshi.eventTitle}: ${p.kalshi.subtitle}` : p.kalshi.title}`,
        `<> ${p.polymarket.title}`,
      ].join("  "),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
