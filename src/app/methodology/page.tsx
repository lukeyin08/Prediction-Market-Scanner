export const metadata = { title: "Method · Prediction Market Scanner" };

export default function Methodology() {
  return (
    <div className="prose">
      <h1>Method</h1>
      <p className="lede">What the scanner computes, and where it can be wrong.</p>

      <h2>1. Pull live binary contracts</h2>
      <p>
        Kalshi events (with nested markets) and Polymarket events from Gamma&apos;s keyset endpoint, paged with cursors.
        Multi-leg combos, non Yes/No markets, contracts with no quotes, illiquid contracts (open interest or liquidity
        under 50), and anything closing more than ~13 months out are dropped. The top 400 matches by score are priced
        against live order books; any limit that is hit is shown on the Live page.
      </p>

      <h2>2. Match the same contract across venues</h2>
      <p>
        The venues phrase identical contracts differently (&ldquo;Cut 25bps&rdquo; vs &ldquo;Fed decreases interest
        rates by 25 bps&rdquo;). Text is canonicalized (synonyms, phrases, stemming), and numeric thresholds, years,
        calendar dates (&ldquo;before Nov 1&rdquo; is stored as Oct 31), over/under direction, inequality bounds, party
        order, negation, and resolution shape (range vs threshold, touch vs on-a-date, individual vs race, announcement
        vs event) are pulled out as structured features. Similarity is TF-IDF cosine with IDF fit on both venues. A
        pair is <strong>rejected outright</strong> when any of those features disagree, when resolution-defining words
        differ (votes vs seats, nominee vs winner, coding vs overall), or when close dates are more than 45 days apart,
        and kept only if each side is the other&apos;s best match. An optional LLM pass (off unless{" "}
        <code>ANTHROPIC_API_KEY</code> is set) reads both titles and rules and vetoes pairs that don&apos;t resolve
        identically.
      </p>

      <h2>3. Price the hedge against real depth</h2>
      <p>
        One YES plus one NO on the same outcome always pays $1. For each pair, both directions are evaluated by walking
        both ask ladders together in whole contracts, then keeping the prefix with the highest profit after exact
        fees:
      </p>
      <pre>{`profit = contracts − Σ price·size − fees
Kalshi fee      = ceil_cent(0.07 · C · P · (1 − P))      per price level
Polymarket fee  = round5(rate · C · (P · (1 − P))^exp)   taker, per market`}</pre>
      <p>
        Kalshi only publishes bids, so its YES asks are its NO bids mirrored (ask = 1 − bid). Fees are rounded once per
        price level; Kalshi rounds per resting order, so the true fee can be a cent or two higher. Trades that rounding
        makes unprofitable are dropped. Annualized return is simple (not compounded): profit over capital (cost + fees),
        scaled to the later close date, since the money is locked until then.
      </p>

      <h2>4. Measure persistence</h2>
      <p>
        A GitHub Action runs a full scan every 30 minutes and appends a snapshot to the <code>data</code> branch. An
        episode ends only when a scan prices the pair and finds no edge; a missing pair or failed order book is a gap.
        Lifetimes are bracketed between first-to-last profitable sighting and flat-scan-before to flat-scan-after, and
        episodes cut off by the start or end of the data are excluded from the statistics.
      </p>

      <h2>Known limitations</h2>
      <ul>
        <li>Matching is heuristic. Always read both contracts&apos; resolution rules: different sources or deadlines turn an arbitrage into two unhedged bets.</li>
        <li>Books move between the two fetches; quoted size is an upper bound.</li>
        <li>Ignores deposit/withdrawal costs, Polymarket gas, and that Kalshi is US-only while Polymarket&apos;s international exchange is not available to US persons.</li>
        <li>30-minute sampling misses short-lived edges, so fast arbitrage is undercounted.</li>
        <li>Only the top 400 matched pairs are priced each run.</li>
      </ul>
    </div>
  );
}
