# Prediction Market Scanner

Finds the same event priced differently on **Kalshi** and **Polymarket**, and tells you whether the gap is real money after fees and order book depth, or just noise.

![Dashboard: matched pairs, executable size and profit after fees, and the fill-by-fill trade for one pair](docs/dashboard.png)

If YES on one venue plus NO on the other costs less than $1, the difference is locked in at resolution, as long as both contracts resolve the same way. The hard parts are knowing that two differently worded contracts *are* the same contract, and knowing how much size you can actually trade before fees and the book eat the edge. This project does both, then logs a scan every 30 minutes to measure how long these edges survive.

## What it does

1. **Pulls live binary contracts** from both venues' public APIs: Kalshi events with nested markets, and Polymarket's Gamma `/events/keyset` endpoint (cursor pagination; the offset endpoint silently caps at ~2,000 events). It keeps contracts that close within ~13 months and have at least minimal liquidity, and skips multi-leg combos.
2. **Matches equivalent contracts across venues.** "Fed decision in Dec 2026: Cut 25bps" and "Will the Fed decrease interest rates by 25 bps after the December 2026 meeting?" share few words. The matcher canonicalizes phrasing, scores TF-IDF cosine similarity, keeps only *mutual* best matches, and applies hard rules that text similarity misses. A pair is rejected outright if any of these disagree:
   - numeric thresholds, including inequalities (`>25bps` is not `25bps`)
   - calendar dates, normalized so "before Nov 1" equals "by Oct 31"
   - resolution shape: a range bucket vs a threshold, touching a level by a deadline vs its value on a date, an individual outcome vs a race ("next leader out"), an announcement vs the event
   - years, months, over/under direction, negation, party order ("D Senate, R House")
   - resolution-defining words such as votes vs seats, nominee vs winner, "coding" model vs "AI" model, Q3 vs Q4
   - optional: an LLM reads both contracts' rules and vetoes pairs that don't resolve identically (off unless `ANTHROPIC_API_KEY` is set; not enabled in the published data)
3. **Prices the hedge against real depth.** For each pair it walks both ask ladders together in whole contracts, keeps the prefix with the highest profit after exact fees, and reports executable size, profit, and simple annualized return on locked-up capital.
4. **Measures persistence.** A GitHub Action scans every 30 minutes and appends to the `data` branch; the Persistence page turns that history into "episodes" with lower and upper bounds on how long each edge lasted.

## Results (Oct 27, 2026, scanner v5)

One full scan covers **105,722 contracts** (42,563 Kalshi and 63,159 Polymarket) in about 2 minutes.

- **1,329 matched pairs.** The top 400 by match score are priced against live order books (a cap to stay within API rate limits).
- **48 had positive edge after fees, about $339 executable in total** on $49K of capital, about 0.7%.
- The edge is concentrated and mostly sits in long shots:
  - One pair is 48% of the total. Kalshi priced María Corina Machado leading Venezuela at year end at 5–7¢, while Polymarket priced it at 0.3–0.4¢. That is $162 on $4.8K locked for 65 days, about 19% annualized, with resolution-timing differences between the venues.
  - 22 of the 48 trades buy at least one leg under 2¢.
  - 35 of the 48 buy YES on Polymarket and NO on Kalshi, which is consistent with Kalshi pricing long shots richer than Polymarket.
- **Contracts priced like real coin flips are efficient.** Of 100 pairs with a Kalshi midpoint between 10¢ and 90¢, 8 had any edge after fees.

The honest read: cross-venue edges exist, but at displayed depth they are small and concentrated in the tails, where queue position, fills at the minimum tick, and rule differences matter more than the headline number.

### How the matcher got here

The first version matched on text similarity and reported 111 pairs and "$7.7K of arbitrage." Reviewing them by hand showed most were different contracts with similar wording. Then an adversarial review found holes that today's data happened not to exercise. Every case below is now a hard rule with a regression test (`tests/match.test.ts`, `tests/match-adversarial.test.ts`):

| Looked the same | Actually different because |
|---|---|
| "Bitcoin price at the end of 2026: 90,000 to 94,999.99" vs "Will Bitcoin reach $90,000 by December 31, 2026?" | a year-end range vs touching a level at any time |
| "Will Vladimir Putin leave President of Russia before Jan 1, 2027?" vs "Will Vladimir Putin be the next leader out before 2027?" | an individual event vs a race among many leaders |
| "Fed decision: Cut >25bps" vs "Fed decreases rates by 25 bps" | ">25" means a 50bp+ cut |
| "Best *coding* model at end of 2026: Google" vs "Google best AI model end of 2026?" | different leaderboards |
| "Anthropic officially *announces* an IPO" vs "Anthropic IPO by Nov 15?" | announcement vs completion |
| December Fed "Cut 25bps" vs the *October* meeting's 25 bps cut (when December was missing) | different meeting; month mismatches now reject |
| "Fed **dec**ision: 25 bps cut" | "dec" was read as December and the 25 was dropped; months now match whole words |
| "Will Shrek 5 be delayed? (before Jul 1, 2027)" vs "Will Shrek 5 be delayed?" | one of several dated contracts vs an undated one |

On a 30,940 × 1,212 market dump, the current matcher accepts 60 pairs, all correct on manual review. On the live scan, every non-sports pair was reviewed by hand and each sports family (NHL awards, NASCAR, European leagues, esports) was spot-checked. `npm run eval` replays the matcher on any dump.

`SCANNER_VERSION` (matching + pricing) is stamped on every snapshot, so persistence statistics never mix results from older logic.

## Fee model

| Venue | Taker fee | Notes |
|---|---|---|
| Kalshi | `ceil_to_cent(coeff × C × P × (1 − P))`, coeff 0.07 | Some index series (KXINX, KXNASDAQ100) use 0.035. |
| Polymarket | `round5(rate × C × (P × (1 − P))^exponent)` | `rate` and `exponent` come from each market's `feeSchedule`; many markets are fee-free. Makers pay nothing. |

Kalshi's book only lists bids, so its YES asks are derived from NO bids (`ask = 1 − bid`). Fees are rounded once per price level traded. Kalshi rounds per resting order, so the real fee can be a cent or two higher when a level holds several orders; modeled profit is an upper bound by that margin. Trades that rounding makes unprofitable are dropped, not reported as tiny wins.

## Persistence method

- An **episode** is a run of scans in which a pair is profitable in the same direction.
- It ends only when a scan **prices the pair and finds no edge**. A pair missing from a scan, or with a failed order book, counts as a gap, not a close. A gap over 75 minutes ends the episode as censored.
- Each lifetime is bracketed:
  - The **lower bound** is first to last profitable sighting.
  - The **upper bound** is the flat scan before to the flat scan after.
- Episodes cut off by the start or end of the data (**censored**) are excluded from lifetime statistics.

## Run it

```bash
npm install
npm run scan                 # one scan, printed to the terminal
npm run dev                  # dashboard at http://localhost:3000
npm test                     # 67 tests: fees, book walk, matching, adversarial cases, parsing, persistence
npm run eval -- markets.json # replay the matcher on a market dump (see scripts/eval-matcher.ts)
```

The dashboard serves the latest scheduled snapshot, because a full-coverage scan takes longer than a serverless request should. It only scans live, time-boxed, if no snapshot exists.

## Project layout

```
src/lib/
  kalshi.ts       Kalshi client: events, markets, order books (bids mirrored to asks)
  polymarket.ts   Polymarket client: Gamma keyset pagination, CLOB /books batch endpoint
  normalize.ts    canonicalization; numbers, bounds, dates, shape, party, negation features
  match.ts        TF-IDF matching, hard constraints, mutual best match
  fees.ts         Kalshi and Polymarket fee schedules
  arb.ts          two-ladder book walk in whole contracts, best rounded-fee prefix
  llm.ts          optional LLM equivalence check
  scan.ts         end-to-end scan with a shared deadline
  history.ts      snapshots and censoring-aware episode analysis
  version.ts      SCANNER_VERSION
src/app/          Next.js dashboard (Live, Persistence, Method)
scripts/          scan / snapshot / analyze / dump / eval CLIs
tests/            vitest suite
.github/workflows snapshot job (every 30 min), market dump for matcher eval, CI
```

## Limitations

- Matching is heuristic. Before trading, read both contracts' resolution rules: a different data source, deadline, or fallback clause turns an "arbitrage" into two unhedged bets. For example, the Venezuela contracts resolve at 10 AM ET on Kalshi and noon ET on Polymarket, and Polymarket has a UN-list fallback.
- Only the top 400 matched pairs are priced each run.
- Books move between the two venue fetches, so quoted size is an upper bound.
- Ignores deposit and withdrawal costs and venue eligibility (Kalshi is US-regulated; Polymarket's international exchange is not available to US persons).
- 30-minute sampling undercounts short-lived edges.
- GitHub disables scheduled workflows after 60 days without repository activity, and the dashboard flags data older than 2 hours as stale.
- The `data` branch grows by a few MB a day.

Not investment advice.

## License

MIT
