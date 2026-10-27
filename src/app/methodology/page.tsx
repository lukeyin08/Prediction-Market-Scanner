export const metadata = { title: "How it works · prediction-market-scanner" };

export default function Methodology() {
  return (
    <div className="prose">
      <h1>How it works</h1>

      <h2>Pulling contracts</h2>
      <p>
        From Kalshi I pull events with their nested markets, and from Polymarket the events on Gamma&apos;s keyset
        endpoint, both paged with cursors. I drop multi-leg combos, anything that isn&apos;t a Yes/No market, contracts
        with no quotes, contracts with open interest or liquidity under 50, and anything closing more than about 13
        months out. The top 400 matches by score get priced against live order books. If a limit is hit, the scan page
        says so.
      </p>

      <h2>Matching</h2>
      <p>
        The two sites word the same contract differently (&ldquo;Cut 25bps&rdquo; on one, &ldquo;Fed decreases interest
        rates by 25 bps&rdquo; on the other). Titles get normalized with synonyms and stemming, and then I pull out the
        parts that decide how a contract resolves: thresholds, years, dates (&ldquo;before Nov 1&rdquo; becomes Oct 31),
        over or under, inequality bounds, party order, negation, and the shape of the question (a range vs a threshold,
        touching a price vs being there on a date, one person vs a whole race, an announcement vs the event itself).
      </p>
      <p>
        Similarity is TF-IDF cosine, with IDF fit on both sites together. A pair is thrown out if any of those parts
        disagree, if a word that changes the resolution differs (votes vs seats, nominee vs winner), or if the close
        dates are more than 45 days apart. It&apos;s kept only if each side is the other&apos;s best match.
      </p>

      <h2>Pricing</h2>
      <p>
        One YES plus one NO on the same outcome pays $1. For each pair I try both directions, walking both ask ladders
        together in whole contracts, and keep the size with the highest profit after fees:
      </p>
      <pre>{`profit = contracts - sum(price * size) - fees
Kalshi fee     = ceil_cent(0.07 * C * P * (1 - P))      per price level
Polymarket fee = round5(rate * C * (P * (1 - P))^exp)   taker, per market`}</pre>
      <p>
        Kalshi&apos;s API only gives bids, so a YES ask is 1 minus the best NO bid. I round fees once per price level.
        Kalshi rounds per resting order, so the real fee can be a cent or two higher, and any trade that rounding would
        flip to a loss is dropped. Annualized return is simple, not compounded: profit over cost plus fees, scaled to
        the later of the two close dates, since the money is stuck until then.
      </p>

      <h2>History</h2>
      <p>
        A GitHub Action runs the scan every 30 minutes and appends the result to the <code>data</code> branch. A gap
        ends only when a scan prices the pair and finds nothing. A missing pair or a failed order book is a hole in the
        data, not an end. Each lifetime gets a lower bound (first to last sighting) and an upper bound (the clean scan
        before to the clean scan after). Gaps cut off by the start or end of the data are left out.
      </p>

      <h2>What it gets wrong</h2>
      <ul>
        <li>Matching is heuristic. If two contracts use different sources or deadlines, a &ldquo;hedge&rdquo; is really two separate bets.</li>
        <li>The books move between the two fetches, so the size shown is a ceiling.</li>
        <li>It ignores deposit and withdrawal costs and Polymarket gas. Kalshi is US-only and Polymarket&apos;s international exchange isn&apos;t open to US persons, so most people can&apos;t do both legs anyway.</li>
        <li>Sampling every 30 minutes misses anything shorter, so fast gaps are undercounted.</li>
        <li>Only the top 400 matched pairs get priced each run.</li>
      </ul>
    </div>
  );
}
