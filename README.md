# prediction-market-scanner

Compares prices on Kalshi and Polymarket for the same contracts and checks whether any gap survives fees and order book depth.

Live: https://prediction-market-scanner-one.vercel.app

![Scan page: matched pairs with the cost of a $1 pair, size, and profit after fees](docs/dashboard.png)

If YES on one site plus NO on the other costs less than $1, you get $1 back at resolution either way, as long as both contracts resolve on the same thing. Most of the work here is checking that last part. Two contracts with almost the same title often resolve on different dates, thresholds, or sources. The rest is figuring out how many contracts you can actually buy before the book and the fees eat the gap. A scan also runs every 30 minutes so I can see how long gaps last.

## How it works

1. Pull open binary contracts from both public APIs. Kalshi: events with nested markets. Polymarket: Gamma's `/events/keyset` endpoint with cursor paging (the offset endpoint quietly stops at about 2,000 events). Contracts closing more than about 13 months out, illiquid ones, and multi-leg combos are dropped.
2. Match contracts across the two sites. "Fed decision in Dec 2026: Cut 25bps" and "Will the Fed decrease interest rates by 25 bps after the December 2026 meeting?" share very few words. The matcher normalizes wording, scores TF-IDF cosine similarity, and keeps only pairs where each side is the other's best match. Then it rejects any pair where one of these disagrees:
   - numeric thresholds, including inequalities (`>25bps` is not `25bps`)
   - dates, normalized so "before Nov 1" equals "by Oct 31"
   - what kind of question it is: a range bucket vs a threshold, touching a level by a deadline vs the value on a date, one person vs a race ("next leader out"), an announcement vs the event
   - years, months, over/under, negation, party order ("D Senate, R House")
   - words that change resolution, like votes vs seats, nominee vs winner, "coding" model vs "AI" model, Q3 vs Q4
3. Price each pair against the order books. Walk both ask ladders together in whole contracts, keep the size with the most profit after fees, and report size, profit, and simple annualized return on the money tied up.
4. Track gaps over time. A GitHub Action scans every 30 minutes and appends to the `data` branch. The history page turns that into episodes with a lower and upper bound on how long each gap lasted.

## Results (Oct 27, 2026, scanner v5)

One scan reads 105,722 contracts (42,563 on Kalshi, 63,159 on Polymarket) in about 2 minutes.

- 1,329 matched pairs. The top 400 by match score get priced against live books, to stay under rate limits.
- 48 pairs were under $1 after fees, worth about $339 in total on $49K of capital, roughly 0.7%.
- Almost all of it is in long shots:
  - One pair is 48% of the total. Kalshi had María Corina Machado leading Venezuela at year end at 5 to 7¢, Polymarket at 0.3 to 0.4¢. That's $162 on $4.8K for 65 days, about 19% annualized, and the two sites resolve at different times of day.
  - 22 of the 48 trades buy at least one leg under 2¢.
  - 35 of the 48 buy YES on Polymarket and NO on Kalshi, so Kalshi seems to price long shots higher.
- Contracts that are actually close to a coin flip are priced the same on both. Of 100 pairs with a Kalshi midpoint between 10¢ and 90¢, 8 had any gap after fees.

So gaps exist, but at the size on the books they're small and sit in the tails, where queue position, minimum-tick fills, and rule differences matter more than the number in the table.

### False matches

The first version matched on text similarity alone. It found 111 pairs and "$7.7K of arbitrage." When I went through them by hand, most were different contracts with similar wording. A later adversarial review found more cases that the live data just hadn't hit yet. Each one below is now a rule with a regression test (`tests/match.test.ts`, `tests/match-adversarial.test.ts`):

| Looked the same | Why it's different |
|---|---|
| "Bitcoin price at the end of 2026: 90,000 to 94,999.99" vs "Will Bitcoin reach $90,000 by December 31, 2026?" | year-end range vs touching a level at any point |
| "Will Vladimir Putin leave President of Russia before Jan 1, 2027?" vs "Will Vladimir Putin be the next leader out before 2027?" | one person vs a race among many leaders |
| "Fed decision: Cut >25bps" vs "Fed decreases rates by 25 bps" | ">25" means 50bp or more |
| "Best coding model at end of 2026: Google" vs "Google best AI model end of 2026?" | different leaderboards |
| December Fed "Cut 25bps" vs the October meeting's 25 bps cut (when December was missing) | different meeting, so month mismatches now reject |
| "Fed decision: 25 bps cut" | "dec" was read as December and the 25 got dropped; months now only match whole words |
| "Will Shrek 5 be delayed? (before Jul 1, 2027)" vs "Will Shrek 5 be delayed?" | one of several dated contracts vs an undated one |

On a 30,940 × 1,212 market dump the current matcher accepts 60 pairs, and all 60 were right when I checked them by hand. On the live scan I reviewed every non-sports pair and spot-checked each sports group (NHL awards, NASCAR, European leagues, esports). `npm run eval` replays the matcher on any dump.

Every snapshot is stamped with `SCANNER_VERSION`, so the history stats never mix in results from older matching or pricing code.

## Fees

| Site | Taker fee | Notes |
|---|---|---|
| Kalshi | `ceil_to_cent(coeff × C × P × (1 − P))`, coeff 0.07 | Some index series (KXINX, KXNASDAQ100) use 0.035. |
| Polymarket | `round5(rate × C × (P × (1 − P))^exponent)` | `rate` and `exponent` come from each market's `feeSchedule`. Many markets have no fee. Makers pay nothing. |

Kalshi's book only lists bids, so a YES ask is 1 minus the best NO bid. I round fees once per price level. Kalshi rounds per resting order, so the real fee can be a cent or two higher when a level has several orders, which makes the profit here an upper bound by about that much. Trades that rounding would turn into a loss are dropped instead of shown as tiny wins.

## Measuring how long gaps last

- An episode is a run of scans where a pair is profitable in the same direction.
- It only ends when a scan prices the pair and finds no gap. If the pair is missing from a scan or its book fails to load, that's a hole in the data, not an end. A hole longer than 75 minutes ends the episode as censored.
- Each lifetime gets two numbers: a lower bound (first to last profitable scan) and an upper bound (the clean scan before to the clean scan after).
- Episodes cut off by the start or end of the data are left out of the lifetime stats.

## Running it

```bash
npm install
npm run scan                 # one scan, printed to the terminal
npm run dev                  # site at http://localhost:3000
npm test                     # 68 tests: fees, book walk, matching, adversarial cases, parsing, history
npm run eval -- markets.json # replay the matcher on a market dump (see scripts/eval-matcher.ts)
```

The site serves the latest scheduled snapshot, since a full scan takes longer than a serverless request should. If there's no snapshot it runs a shorter live scan with a time limit.

## Layout

```
src/lib/
  kalshi.ts       Kalshi client: events, markets, order books (bids mirrored to asks)
  polymarket.ts   Polymarket client: Gamma keyset paging, CLOB /books batch endpoint
  normalize.ts    text normalization; numbers, bounds, dates, question shape, party, negation
  match.ts        TF-IDF matching, hard rules, mutual best match
  fees.ts         Kalshi and Polymarket fee schedules
  arb.ts          two-ladder book walk in whole contracts
  scan.ts         full scan with a shared deadline
  history.ts      snapshots and episode analysis
  version.ts      SCANNER_VERSION
src/app/          Next.js site (scan, history, how it works)
scripts/          scan / snapshot / analyze / dump / eval CLIs
tests/            vitest
.github/workflows snapshot job (every 30 min), market dump for matcher eval, CI
```

## Limitations

- Matching is heuristic. Read both contracts' resolution rules before trading anything. A different data source, deadline, or fallback clause means you hold two separate bets. For example, the Venezuela contracts resolve at 10 AM ET on Kalshi and noon ET on Polymarket, and Polymarket has a fallback to a UN list.
- Only the top 400 matched pairs get priced each run.
- Books move between the two fetches, so the size shown is a ceiling.
- Deposit and withdrawal costs and eligibility are ignored. Kalshi is US-regulated and Polymarket's international exchange isn't open to US persons.
- Sampling every 30 minutes undercounts short gaps.
- GitHub turns off scheduled workflows after 60 days with no repo activity. The site marks data older than 2 hours as stale.
- The `data` branch grows by a few MB a day.

## License

MIT
