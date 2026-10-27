"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
      // No trade yet, ordered by how close the cheapest pair comes to $1.
      return pairs
        .filter((p) => !p.best)
        .map((p) => ({ p, b: breakdown(p) }))
        .filter((x): x is { p: PairResult; b: Breakdown } => x.b !== null)
        .sort((a, b) => b.b.edge - a.b.edge)
        .map((x) => x.p);
    return pairs;
  }, [pairs, view]);

  const s = scan?.stats;

  return (
    <>
      <h1>Kalshi vs Polymarket</h1>
      <p>
        Both sites list a lot of the same questions. If YES on one plus NO on the other costs less than $1 after fees,
        you get paid $1 whichever way it resolves. This page lists the pairs where that was true in the last scan,
        using the actual order books and each site&apos;s fee formula.
      </p>
      <p className="muted">
        The hard part was matching. Plenty of contracts with nearly identical titles resolve on different dates or
        thresholds, so the matcher is strict and still gets things wrong. Read both sets of rules before trusting a row.
      </p>

      {s && (
        <p>
          Last scan: {((s.kalshiMarkets ?? 0) + (s.polymarketMarkets ?? 0)).toLocaleString()} contracts,{" "}
          {s.matchedPairs ?? 0} matched pairs, {s.opportunities ?? 0} under $1 after fees, {usd(s.executableProfit)} total
          at the sizes on the books.
        </p>
      )}

      <div className="views" role="group" aria-label="Which pairs to show">
        <button aria-pressed={view === "arb"} onClick={() => setView("arb")}>
          under $1{s ? ` (${s.opportunities})` : ""}
        </button>
        <button aria-pressed={view === "near"} onClick={() => setView("near")}>
          closest misses
        </button>
        <button aria-pressed={view === "all"} onClick={() => setView("all")}>
          all pairs{s ? ` (${s.matchedPairs})` : ""}
        </button>
        <span className="stamp small muted">
          {scan && (
            <>
              {isStale(scan.generatedAt) ? "stale, " : ""}
              scanned {timeAgo(scan.generatedAt)}
              {" · "}
            </>
          )}
          <button onClick={load} disabled={loading}>
            {loading ? "loading" : "reload"}
          </button>
        </span>
      </div>

      {error && <p className="error">Couldn&apos;t load the scan: {error}</p>}
      {scan?.errors?.length && scan.complete === false ? (
        <p className="error">Partial data: {scan.errors.join("; ")}</p>
      ) : null}
      {scan && (scan.errors.length > 0 || (scan.warnings?.length ?? 0) > 0) && scan.complete !== false && (
        <p className="small muted">{[...scan.errors, ...(scan.warnings ?? [])].join(". ")}.</p>
      )}

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Contract</th>
              <th className="n">Kalshi YES</th>
              <th className="n">Poly YES</th>
              <th>Cost of $1 pair</th>
              <th className="n">Left</th>
              <th className="n">Size</th>
              <th className="n">Profit</th>
              <th className="n">Annual.</th>
              <th className="n">Closes</th>
            </tr>
          </thead>
          <tbody>
            {loading && !scan
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={9}>
                      <div className="skeleton" />
                    </td>
                  </tr>
                ))
              : rows.map((p) => (
                  <Row key={p.id} pair={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
                ))}
            {!loading && scan && !rows.length && (
              <tr>
                <td colSpan={9} className="muted">
                  {view === "arb"
                    ? "Nothing under $1 after fees in this scan. Try closest misses, or the history page."
                    : "No pairs matched in this scan."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Bar: <span className="k">Kalshi leg</span>, <span className="p">Polymarket leg</span>, grey for fees, yellow for
        what&apos;s left. The tick mark is $1. Click a row for the order book fills.
      </p>
    </>
  );
}

function Row({ pair: p, open, onToggle }: { pair: PairResult; open: boolean; onToggle: () => void }) {
  const b = breakdown(p);
  const close = earliestClose(p.kalshi.closeTime, p.polymarket.closeTime);
  const detailId = `detail-${p.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const h = headline(p);

  return (
    <Fragment>
      <tr>
        <td>
          <button type="button" className="toggle" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
            <b>{h.title}</b>
            <br />
            <span className="q">{h.context}</span>
          </button>
          {p.llm && !p.llm.same && <div className="small error">LLM check says the rules differ</div>}
        </td>
        <td className="n">
          {cents(p.kalshi.yesAsk)}
          <div className="small muted">bid {cents(p.kalshi.yesBid)}</div>
        </td>
        <td className="n">
          {cents(p.polymarket.yesAsk)}
          <div className="small muted">bid {cents(p.polymarket.yesBid)}</div>
        </td>
        <td>{b ? <DollarBar b={b} /> : <span className="muted">no quotes</span>}</td>
        <td
          className={`n ${b && b.exact && b.edge > 0 ? "pos" : "muted"}`}
          title={b && !b.exact ? "At the best price on each book; no whole-contract trade clears fees" : undefined}
        >
          {b ? `${b.edge < 0 ? "−" : ""}${c(Math.abs(b.edge), 2)}` : "-"}
        </td>
        <td className="n">{p.best ? p.best.contracts.toLocaleString() : "-"}</td>
        <td className={`n${p.best ? " pos" : " muted"}`}>{p.best ? usd(p.best.profit) : "-"}</td>
        <td className="n">{p.best?.annualizedReturn != null ? pct(p.best.annualizedReturn, 0) : "-"}</td>
        <td className="n">{shortDate(close)}</td>
      </tr>
      {open && (
        <tr className="more" id={detailId}>
          <td colSpan={9}>
            <Detail pair={p} b={b} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Detail({ pair: p, b }: { pair: PairResult; b: Breakdown | null }) {
  const legs = p.best ? groupFills(p.best.fills) : [];
  return (
    <div className="more-grid">
      <div>
        <h3>{p.best ? "Trade" : "No trade"}</h3>
        {p.best ? (
          <>
            <p className="small">
              {usd(p.best.cost)} in contracts plus {usd(p.best.fees)} in fees, pays {usd(p.best.contracts)}.
            </p>
            {legs.map((leg) => (
              <table className="fills" key={leg.key}>
                <tbody>
                  <tr>
                    <td className={leg.venue === "kalshi" ? "k" : "p"}>
                      {leg.side} on {leg.venue === "kalshi" ? "Kalshi" : "Polymarket"}
                    </td>
                    <td>avg {cents(leg.avg)}</td>
                  </tr>
                  {leg.fills.map((f) => (
                    <tr key={f.price}>
                      <td className="muted">{f.size.toLocaleString()} at</td>
                      <td className="muted">{cents(f.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </>
        ) : (
          <p className="small">
            {b
              ? `Cheapest combo is ${legLabel(b.legs[0])} plus ${legLabel(b.legs[1])}, about ${c(1 - b.edge)} with fees.`
              : "One side has no quotes."}
          </p>
        )}
      </div>
      <div>
        <h3>Things to check</h3>
        <ul className="small">
          {p.flags.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
          {p.llm && <li>LLM check: {p.llm.note}</li>}
          <li>Resolution rules. A different source or deadline makes this two separate bets.</li>
        </ul>
      </div>
      <div>
        <h3>Links</h3>
        <p className="small">
          <a href={p.kalshi.url} target="_blank" rel="noreferrer">
            Kalshi
          </a>
          : {p.kalshi.title}
          <br />
          <a href={p.polymarket.url} target="_blank" rel="noreferrer">
            Polymarket
          </a>
          : {p.polymarket.title}
        </p>
        <p className="small muted">
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
