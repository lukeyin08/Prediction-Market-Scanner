# Prediction Market Scanner

Finds the same event priced differently on **Kalshi** and **Polymarket**, and tells you whether the gap is real money after fees and order book depth, or just noise.

If YES on one venue plus NO on the other costs less than $1, the difference is locked in at resolution, as long as both contracts resolve the same way. The hard parts are knowing that two differently-worded contracts *are* the same contract, and knowing how much size you can actually trade before fees and the book eat the edge. This project does both, then logs every scan to measure how long these edges survive.

## What it does

1. **Pulls every live binary contract** from both venues' public APIs (Kalshi events with nested markets, Polymarket's Gamma API).
2. **Matches equivalent contracts across venues.** "Fed decision in December: Cut 25bps" on Kalshi and "Fed decreases interest rates by 25 bps after December 2026 meeting?" on Polymarket share few words. The matcher canonicalizes phrasing, scores TF-IDF cosine similarity, and then applies hard constraints that pure text similarity misses:
   - numeric thresholds must agree (`BTC > $100k` never matches `BTC > $120k`)
   - years and over/under direction must agree
   - close dates must be within 45 days
   - each side must be the other's *mutual* best match
   - optional: an LLM reads both contracts' resolution rules and vetoes pairs that don't resolve identically
3. **Prices the hedge against real depth.** For each pair it walks both ask ladders together, buying while the *marginal* contract is still profitable after fees, and reports executable size, profit, and annualized return on locked-up capital.
4. **Measures persistence.** A GitHub Action scans every 30 minutes and appends to the `data` branch; the dashboard turns that history into "episodes" and shows how long an edge stays open.

## Fee model

| Venue | Taker fee | Notes |
|---|---|---|
| Kalshi | `ceil_to_cent(0.07 × C × P × (1 − P))` | Rounded up **per fill**, so tiny orders pay a full cent. Some index series use 0.035. |
| Polymarket | `round5(rate × C × P × (1 − P))` | Rate read per market from `feeSchedule`; many markets are fee-free. Makers pay nothing. |

Kalshi's book only lists bids, so its YES asks are derived from NO bids (`ask = 1 − bid`). Per-fill rounding is applied exactly, and trades that rounding pushes negative are dropped rather than reported as tiny wins.

## Run it

```bash
npm install
npm run scan            # one scan, printed to the terminal
npm run dev             # dashboard at http://localhost:3000
npm test                # fee math, book walking, matching, parsing, persistence
```

Optional: set `ANTHROPIC_API_KEY` (see `.env.example`) to turn on the LLM equivalence check. For the scheduled job, add the same key as a repository secret.

## Project layout

```
src/lib/
  kalshi.ts       Kalshi client: events, markets, order books (bids mirrored to asks)
  polymarket.ts   Polymarket client: Gamma events, CLOB /books batch endpoint
  normalize.ts    canonicalization + numeric/year/direction feature extraction
  match.ts        TF-IDF matching, hard constraints, mutual best match
  fees.ts         exact Kalshi and Polymarket fee schedules
  arb.ts          two-ladder book walk, profit, annualized return
  llm.ts          optional LLM equivalence check
  scan.ts         end-to-end scan
  history.ts      snapshots and arbitrage-episode analysis
src/app/          Next.js dashboard (Live, Persistence, Method)
scripts/          scan / snapshot / analyze CLIs
tests/            vitest suite
.github/workflows snapshot job (every 30 min) and CI
```

## Limitations

- Matching is heuristic. Before trading, read both contracts' resolution rules: a different data source or deadline turns an "arbitrage" into two unhedged bets.
- Books move between the two venue fetches, so quoted size is an upper bound.
- Ignores deposit and withdrawal costs and venue eligibility (Kalshi is US-regulated; Polymarket's international exchange is not available to US persons).
- 30-minute sampling undercounts short-lived edges; measured lifetimes are lower bounds.

Not investment advice.

## License

MIT
