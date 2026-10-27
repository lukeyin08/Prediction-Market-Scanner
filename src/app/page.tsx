"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PairResult, ScanResult } from "@/lib/types";
import { getJson } from "./fetch";
import { cents, earliestClose, pct, shortDate, timeAgo, usd } from "./format";
import { breakdown, DollarBar, headline, legLabel, type Breakdown } from "./hedge";

type View = "arb" | "near" | "all";

const c = (x: number, dp = 1) => `${(x * 100).toFixed(dp)}¢`;

export default function LivePage() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("arb");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson<ScanResult>("/api/scan");
      if (!data?.stats || !Array.isArray(data.pairs)) throw new Error("The scan response was malformed.");
      setScan({ ...data, errors: Array.isArray(data.errors) ? data.errors : [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pairs = useMemo(() => scan?.pairs ?? [], [scan]);
  const rows = useMemo(() => {
    if (view === "arb") return pairs.filter((p) => p.best);
    if (view === "near")
      // No edge yet, ordered by how close the cheapest pair comes to costing under $1.
      return pairs
        .filter((p) => !p.best)
        .map((p) => ({ p, b: breakdown(p) }))
        .filter((x): x is { p: PairResult; b: Breakdown } => x.b !== null)
        .sort((a, b) => b.b.edge - a.b.edge)
        .map((x) => x.p);
    return pairs;
  }, [pairs, view]);

  const featured = useMemo(
    () => pairs.filter((p) => p.best).sort((a, b) => (b.best?.profit ?? 0) - (a.best?.profit ?? 0))[0] ?? null,
    [pairs],
  );
  const s = scan?.stats;

  return (
    <>
      <section className="hero" aria-labelledby="title">
        <div>
          <h1 id="title">Same question, two prices.</h1>
          <p className="lede">
            Kalshi and Polymarket often list the same contract. Buying YES on one and NO on the other pays exactly $1
            when it resolves, so if the pair costs less than $1 after fees, the difference is locked in.
          </p>
        </div>

        {featured ? <Featured pair={featured} /> : loading ? <HeroSkeleton /> : null}

        {s && (
          <p className="summary">
            The latest scan read <strong>{((s.kalshiMarkets ?? 0) + (s.polymarketMarkets ?? 0)).toLocaleString()}</strong>{" "}
            contracts, priced <strong>{s.matchedPairs ?? 0}</strong> matched pairs against live order books, and found{" "}
            <strong>{s.opportunities ?? 0}</strong> that cost less than $1 after fees, worth{" "}
            <strong>{usd(s.executableProfit)}</strong> at the depth shown.
          </p>
        )}
      </section>

      <div className="controls">
        <div className="segmented" role="group" aria-label="Which pairs to show">
          <button aria-pressed={view === "arb"} onClick={() => setView("arb")}>
            Under $1{s ? ` (${s.opportunities})` : ""}
          </button>
          <button aria-pressed={view === "near"} onClick={() => setView("near")}>
            Near misses
          </button>
          <button aria-pressed={view === "all"} onClick={() => setView("all")}>
            All pairs{s ? ` (${s.matchedPairs})` : ""}
          </button>
        </div>
        <span className="spacer" />
        {scan && (
          <span className="small muted">
            {isStale(scan.generatedAt) ? "Stale: " : ""}
            {scan.fromSnapshot ? "scheduled scan from " : "scanned "}
            {timeAgo(scan.generatedAt)}
          </span>
        )}
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Loading" : "Reload"}
        </button>
      </div>

      {error && <div className="alert">Couldn&apos;t load the scan: {error}</div>}
      {scan?.errors?.length && scan.complete === false ? (
        <div className="alert">Partial data: {scan.errors.join("; ")}</div>
      ) : null}
      {scan && (scan.errors.length > 0 || (scan.warnings?.length ?? 0) > 0) && scan.complete !== false && (
        <p className="notes">{[...scan.errors, ...(scan.warnings ?? [])].join(". ")}.</p>
      )}

      <div className="list">
        <div className="cols head" aria-hidden>
          <span>Contract</span>
          <span className="num">Kalshi YES</span>
          <span className="num">Polymarket YES</span>
          <span>Cost of a $1 pair</span>
          <span className="num">Left per pair</span>
          <span className="num">Size</span>
          <span className="num">Profit</span>
          <span className="num">Annualized</span>
          <span className="num">Closes</span>
        </div>

        {loading && !scan
          ? Array.from({ length: 6 }, (_, i) => (
              <div className="cols row" key={i}>
                <div className="skeleton" style={{ gridColumn: "1 / -1" }} />
              </div>
            ))
          : rows.map((p) => (
              <Row key={p.id} pair={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
            ))}

        {!loading && scan && !rows.length && (
          <p className="empty">
            {view === "arb"
              ? "No pair costs less than $1 after fees right now. Near misses shows the closest ones, and Persistence shows how often edges appear."
              : "No pairs matched in this scan."}
          </p>
        )}
      </div>
    </>
  );
}

function Featured({ pair: p }: { pair: PairResult }) {
  const b = breakdown(p);
  const best = p.best!;
  if (!b) return null;
  const [l1, l2] = b.legs;
  const close = earliestClose(p.kalshi.closeTime, p.polymarket.closeTime);
  return (
    <figure className="hedge" style={{ margin: 0 }}>
      <p className="hedge-title">{headline(p).title}</p>
      <p className="hedge-sub">
        Largest edge in the latest scan. <span className="venue-k">Kalshi</span>: {p.kalshi.eventTitle || p.kalshi.title}{" "}
        <span className="venue-p">Polymarket</span>: {p.polymarket.title}
      </p>
      <DollarBar b={b} size="hero" />
      <div className="hedge-legend" aria-hidden>
        {b.legs.map((l) => (
          <span key={l.venue}>
            <i className={`swatch ${l.venue === "kalshi" ? "kalshi" : "poly"}`} />
            {legLabel(l)} {c(l.price)}
          </span>
        ))}
        <span>
          <i className="swatch fee" />
          Fees {c(b.fee, 2)}
        </span>
        <span>
          <i className="swatch edge" />
          Left over {c(b.edge, 2)}
        </span>
      </div>
      <figcaption className="hedge-sentence">
        Buy {legLabel(l1)} at {c(l1.price)} and {legLabel(l2)} at {c(l2.price)}. With fees, each pair costs{" "}
        {c(1 - b.edge)} and pays $1, leaving <span className="money">{c(b.edge, 2)}</span>. At the depth on the books
        that&apos;s {best.contracts.toLocaleString()} pairs for <span className="money">{usd(best.profit)}</span>
        {best.annualizedReturn != null ? `, about ${pct(best.annualizedReturn, 0)} annualized` : ""}
        {close ? ` until ${shortDate(close)}` : ""}.
      </figcaption>
    </figure>
  );
}

function HeroSkeleton() {
  return (
    <div className="hedge" aria-hidden>
      <div className="skeleton" style={{ width: "40%", height: 20 }} />
      <div className="skeleton" style={{ marginTop: 34, height: 46 }} />
      <div className="skeleton" style={{ marginTop: 18, width: "70%" }} />
    </div>
  );
}

function Row({ pair: p, open, onToggle }: { pair: PairResult; open: boolean; onToggle: () => void }) {
  const b = breakdown(p);
  const close = earliestClose(p.kalshi.closeTime, p.polymarket.closeTime);
  const detailId = `detail-${p.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const h = headline(p);

  return (
    <div className={`row${open ? " open" : ""}`}>
      <div className="cols" onClick={onToggle}>
        <div className="c-outcome">
          <button
            type="button"
            className="toggle"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <span className="outcome">{h.title}</span>
            <span className="question">{h.context}</span>
          </button>
          {(p.flags.length > 0 || p.llm) && (
            <div className="flags">
              {p.llm && (
                <span className={`flag${p.llm.same ? " ok" : ""}`}>{p.llm.same ? "LLM: same rules" : "LLM: rules differ"}</span>
              )}
              {p.flags.map((f, i) => (
                <span className="flag" key={i}>
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
        <Quote label="Kalshi YES" bid={p.kalshi.yesBid} ask={p.kalshi.yesAsk} />
        <Quote label="Polymarket YES" bid={p.polymarket.yesBid} ask={p.polymarket.yesAsk} />
        <div className="c-bar" data-label="Cost of a $1 pair">
          {b ? <DollarBar b={b} size="mini" /> : <span className="muted small">No quotes</span>}
        </div>
        <span
          className={`num ${b && b.exact && b.edge > 0 ? "edge-pos" : "muted"}`}
          data-label="Left per pair"
          title={b && !b.exact ? "At the best price on each book; no whole-contract trade clears fees" : undefined}
        >
          {b ? `${b.edge < 0 ? "−" : ""}${c(Math.abs(b.edge), 2)}` : "–"}
        </span>
        <span className="num" data-label="Size">
          {p.best ? p.best.contracts.toLocaleString() : "–"}
        </span>
        <span className={`num${p.best ? " edge-pos" : " muted"}`} data-label="Profit">
          {p.best ? usd(p.best.profit) : "–"}
        </span>
        <span className="num" data-label="Annualized">
          {p.best?.annualizedReturn != null ? pct(p.best.annualizedReturn, 0) : "–"}
        </span>
        <span className="num c-close" data-label="Closes">
          {shortDate(close)}
        </span>
      </div>
      {open && <Detail id={detailId} pair={p} b={b} />}
    </div>
  );
}

function Quote({ label, bid, ask }: { label: string; bid: number | null; ask: number | null }) {
  return (
    <span className="num quote" data-label={label}>
      {cents(ask)}
      <small>bid {cents(bid)}</small>
    </span>
  );
}

function Detail({ id, pair: p, b }: { id: string; pair: PairResult; b: Breakdown | null }) {
  const legs = p.best ? groupFills(p.best.fills) : [];
  return (
    <div className="detail" id={id}>
      <div>
        <h3>{p.best ? "The trade" : "Why there's no trade"}</h3>
        {p.best ? (
          <>
            <p style={{ margin: 0 }}>
              {usd(p.best.cost)} in contracts plus {usd(p.best.fees)} in fees, paying {usd(p.best.contracts)} at
              resolution.
            </p>
            {legs.map((leg) => (
              <table className="ladder" key={leg.key}>
                <thead>
                  <tr>
                    <th className={leg.venue === "kalshi" ? "venue-k" : "venue-p"}>
                      Buy {leg.side} on {leg.venue === "kalshi" ? "Kalshi" : "Polymarket"}
                    </th>
                    <th>avg {cents(leg.avg)}</th>
                  </tr>
                </thead>
                <tbody>
                  {leg.fills.map((f) => (
                    <tr key={f.price}>
                      <td>{f.size.toLocaleString()} contracts</td>
                      <td>at {cents(f.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </>
        ) : (
          <p style={{ margin: 0 }}>
            {b
              ? `The cheapest pair, ${legLabel(b.legs[0])} plus ${legLabel(b.legs[1])}, costs about ${c(1 - b.edge)} with fees, ${b.edge < 0 ? "more than" : "about"} the $1 it pays.`
              : "One venue has no quotes on the side needed."}
          </p>
        )}
      </div>
      <div>
        <h3>Check before trading</h3>
        <ul>
          {p.flags.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
          {p.llm && <li>LLM check: {p.llm.note}</li>}
          <li>Read both resolution rules. A different source, deadline, or fallback clause turns this into two separate bets.</li>
        </ul>
      </div>
      <div>
        <h3>Contracts</h3>
        <p style={{ margin: "0 0 6px" }}>
          <a href={p.kalshi.url} target="_blank" rel="noreferrer" className="venue-k">
            Kalshi
          </a>{" "}
          {p.kalshi.title}
        </p>
        <p style={{ margin: "0 0 6px" }}>
          <a href={p.polymarket.url} target="_blank" rel="noreferrer" className="venue-p">
            Polymarket
          </a>{" "}
          {p.polymarket.title}
        </p>
        <p className="muted" style={{ margin: 0 }}>
          Match score {p.score.toFixed(2)}. Fees: Kalshi {feeLabel(p.kalshi.fee.kind === "kalshi" ? p.kalshi.fee.coeff : 0)},
          Polymarket {feeLabel(p.polymarket.fee.kind === "polymarket" ? p.polymarket.fee.rate : 0)}.
        </p>
      </div>
    </div>
  );
}

function feeLabel(coeff: number): string {
  return coeff > 0 ? `${+(coeff * 100).toFixed(2)}% × P(1−P)` : "none";
}

function isStale(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t > 2 * 3600_000;
}

type LegFills = { key: string; venue: string; side: string; avg: number; fills: { price: number; size: number }[] };

function groupFills(fills: { venue: string; side: string; price: number; size: number }[]): LegFills[] {
  const legs = new Map<string, LegFills & { size: number }>();
  for (const f of fills) {
    const key = `${f.venue}|${f.side}`;
    const leg = legs.get(key) ?? { key, venue: f.venue, side: f.side, avg: 0, size: 0, fills: [] };
    leg.fills.push({ price: f.price, size: f.size });
    leg.size += f.size;
    legs.set(key, leg);
  }
  return [...legs.values()].map((leg) => ({
    ...leg,
    fills: leg.fills.sort((a, b) => a.price - b.price),
    avg: leg.fills.reduce((s, f) => s + f.price * f.size, 0) / leg.size,
  }));
}
