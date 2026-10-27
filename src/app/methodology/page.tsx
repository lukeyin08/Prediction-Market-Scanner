export const metadata = { title: "Method · Prediction Market Scanner" };

export default function Methodology() {
  return (
    <div className="prose">
      <h1>Method</h1>
      <p className="sub">What the scanner computes, and where it can be wrong.</p>

      <h2>1. Pull every live binary contract</h2>
      <p>
        Kalshi events (with nested markets) and Polymarket events from the Gamma API, paginated. Multi-leg combos,
        non Yes/No markets, contracts with no quotes, and anything closing more than ~13 months out are dropped.
      </p>

      <h2>2. Match the same contract across venues</h2>
      <p>
        The venues phrase identical contracts differently (&ldquo;Cut 25bps&rdquo; vs &ldquo;Fed decreases interest
        rates by 25 bps&rdquo;). Text is canonicalized (synonyms, phrases, stemming), and numeric thresholds, years,
        months, and over/under direction are pulled out as structured features. Similarity is TF-IDF cosine with IDF fit
        on both venues. A pair is <strong>rejected outright</strong> when thresholds, years, or direction disagree, or
        when close dates are more than 45 days apart, and kept only if each side is the other&apos;s best match. An
        optional LLM pass (set <code>ANTHROPIC_API_KEY</code>) reads both titles and rules and vetoes pairs that
        don&apos;t resolve identically.
      </p>

      <h2>3. Price the hedge against real depth</h2>
      <p>
        One YES plus one NO on the same outcome always pays $1. For each pair, both directions are evaluated by walking
        both ask ladders together and taking liquidity while the marginal contract is still profitable after fees:
      </p>
      <pre>{`profit = contracts − Σ price·size − fees
Kalshi fee      = ceil_cent(0.07 · C · P · (1 − P))      per fill
Polymarket fee  = round5(rate · C · P · (1 − P))          taker, per market`}</pre>
      <p>
        Kalshi only publishes bids, so its YES asks are its NO bids mirrored (ask = 1 − bid). Fees are charged per price
        level, so per-fill rounding is counted; trades that rounding pushes negative are dropped. Annualized return
        divides profit by capital (cost + fees) and scales to the later close date, since the money is locked until then.
      </p>

      <h2>4. Measure persistence</h2>
      <p>
        A GitHub Action runs a scan every 30 minutes and appends a snapshot to the <code>data</code> branch. Runs of
        consecutive profitable scans become episodes; their lifetime distribution shows whether the edge is real and
        tradable or vanishes before anyone could act.
      </p>

      <h2>Known limitations</h2>
      <ul>
        <li>Matching is heuristic. Always read both contracts&apos; resolution rules: different sources or deadlines turn an arbitrage into two unhedged bets.</li>
        <li>Books move between the two fetches; quoted size is an upper bound.</li>
        <li>Ignores deposit/withdrawal costs, Polymarket gas, and that Kalshi is US-only while Polymarket&apos;s international exchange is not available to US persons.</li>
        <li>30-minute sampling misses short-lived edges, so lifetimes are lower bounds and fast arbs are undercounted.</li>
      </ul>
    </div>
  );
}
