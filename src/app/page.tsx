"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { PairResult, ScanResult } from "@/lib/types";
import { getJson } from "./fetch";
import { DIRECTION_LABEL, cents, earliestClose, pct, pts, shortDate, timeAgo, usd } from "./format";

type View = "arb" | "divergence" | "all";

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

  const rows = useMemo(() => {
    const pairs = scan?.pairs ?? [];
    if (view === "arb") return pairs.filter((p) => p.best);
    if (view === "divergence")
      return pairs
        .filter((p) => p.divergence !== null)
        .slice()
        .sort((a, b) => Math.abs(b.divergence!) - Math.abs(a.divergence!));
    return pairs;
  }, [scan, view]);

  const s = scan?.stats;

  return (
    <>
      <h1>Kalshi × Polymarket mispricing</h1>
      <p className="sub">
        The same event, priced on two venues. When YES on one plus NO on the other costs less than $1 after fees, the
        difference is locked in at resolution, as long as both contracts resolve the same way.
      </p>

      <div className="stats">
        <Stat label="Contracts scanned" value={s ? ((s.kalshiMarkets ?? 0) + (s.polymarketMarkets ?? 0)).toLocaleString() : null} />
        <Stat label="Matched pairs" value={s ? String(s.matchedPairs ?? 0) : null} />
        <Stat label="Positive edge after fees" value={s ? String(s.opportunities ?? 0) : null} good={!!s?.opportunities} />
        <Stat label="Executable profit (all)" value={s ? usd(s.executableProfit) : null} good={!!s?.executableProfit} />
      </div>

      <div className="toolbar">
        <button className="tab" aria-pressed={view === "arb"} onClick={() => setView("arb")}>
          Arbitrage{s ? ` (${s.opportunities})` : ""}
        </button>
        <button className="tab" aria-pressed={view === "divergence"} onClick={() => setView("divergence")}>
          Biggest divergences
        </button>
        <button className="tab" aria-pressed={view === "all"} onClick={() => setView("all")}>
          All pairs{s ? ` (${s.matchedPairs})` : ""}
        </button>
        <span className="spacer" />
        {scan && isStale(scan.generatedAt) && (
          <span className="pill warn" title="The scheduled snapshot job may have stopped">
            stale
          </span>
        )}
        {scan && (
          <span className="muted small" title="Results are cached for up to 2 minutes">
            {scan.fromSnapshot ? "Scheduled snapshot from " : "Scanned "}
            {timeAgo(scan.generatedAt)}
          </span>
        )}
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Reload"}
        </button>
      </div>

      {error && <div className="notice warn">Couldn&apos;t load the scan: {error}</div>}
      {scan?.errors?.length ? <div className="notice warn">Partial data: {scan.errors.join("; ")}</div> : null}
      {scan?.warnings?.length ? <p className="muted small">Limits: {scan.warnings.join("; ")}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contracts</th>
              <th className="num">Match</th>
              <th className="num">Kalshi YES</th>
              <th className="num">Poly YES</th>
              <th className="num">Gap</th>
              <th className="num">Edge / contract</th>
              <th className="num">Size</th>
              <th className="num">Profit</th>
              <th className="num">Annualized</th>
              <th className="num" title="Earlier of the two venues' close times">
                Closes
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && !scan
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={10}>
                      <div className="skeleton" />
                    </td>
                  </tr>
                ))
              : rows.map((p) => (
                  <Row key={p.id} pair={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
                ))}
            {!loading && scan && !rows.length && (
              <tr>
                <td colSpan={10} className="muted">
                  {view === "arb"
                    ? "No pair is arbitrageable after fees right now. That's normal: check “Biggest divergences” or the Persistence tab."
                    : "No pairs matched."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value, good }: { label: string; value: string | null; good?: boolean }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value${good ? " good" : ""}`}>{value ?? <div className="skeleton" style={{ height: 28 }} />}</div>
    </div>
  );
}

function Row({ pair: p, open, onToggle }: { pair: PairResult; open: boolean; onToggle: () => void }) {
  const top = p.alternatives[0];
  const edge = p.best?.topEdge ?? top?.topEdge ?? null;
  const close = earliestClose(p.kalshi.closeTime, p.polymarket.closeTime);
  const detailId = `detail-${p.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const legs = p.best ? groupFills(p.best.fills) : [];

  return (
    <Fragment>
      <tr className="row" onClick={onToggle}>
        <td>
          <div className="contract">
            <button
              type="button"
              className="expand"
              aria-expanded={open}
              aria-controls={detailId}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <span aria-hidden>{open ? "▾" : "▸"}</span> {p.kalshi.subtitle ?? "Details"}
            </button>
            <span>
              <span className="venue k">K</span>
              {p.kalshi.subtitle ? p.kalshi.eventTitle : p.kalshi.title}
            </span>
            <span className="muted">
              <span className="venue p">P</span>
              {p.polymarket.title}
            </span>
            <span>
              {p.llm && (
                <span className={`pill ${p.llm.same ? "good" : "warn"}`} title={p.llm.note}>
                  {p.llm.same ? "LLM: same contract" : "LLM: differs"}
                </span>
              )}{" "}
              {p.flags.length > 0 && <span className="pill warn">{p.flags.length} caveat{p.flags.length > 1 ? "s" : ""}</span>}
            </span>
          </div>
        </td>
        <td className="num">{p.score.toFixed(2)}</td>
        <td className="num">
          {cents(p.kalshi.yesBid)} / {cents(p.kalshi.yesAsk)}
        </td>
        <td className="num">
          {cents(p.polymarket.yesBid)} / {cents(p.polymarket.yesAsk)}
        </td>
        <td className="num">{pts(p.divergence)}</td>
        <td className={`num ${edge === null ? "" : edge > 0 ? "pos" : edge < 0 ? "neg" : ""}`}>{edge === null ? "–" : cents(edge)}</td>
        <td className="num">{p.best ? p.best.contracts.toLocaleString() : "–"}</td>
        <td className={`num ${p.best ? "pos" : ""}`}>{p.best ? usd(p.best.profit) : "–"}</td>
        <td className="num">{p.best?.annualizedReturn != null ? pct(p.best.annualizedReturn, 0) : "–"}</td>
        <td className="num">{shortDate(close)}</td>
      </tr>
      {open && (
        <tr className="detail" id={detailId}>
          <td colSpan={10}>
            <div className="detail-grid">
              <div>
                <h4>Trade</h4>
                {p.best ? (
                  <>
                    <div>{DIRECTION_LABEL[p.best.direction]}</div>
                    <div className="small muted">
                      Cost {usd(p.best.cost)} + fees {usd(p.best.fees)} → pays {usd(p.best.contracts)} at resolution
                    </div>
                    {legs.map((leg) => (
                      <div key={leg.key} className="leg">
                        <div className="small">
                          <span className={`venue ${leg.venue === "kalshi" ? "k" : "p"}`}>{leg.venue === "kalshi" ? "K" : "P"}</span>
                          Buy {leg.side} · {fmtQty(leg.size)} contracts · avg {cents(leg.avg)}
                        </div>
                        <ul className="mono">
                          {leg.fills.map((f) => (
                            <li key={f.price}>
                              {fmtQty(f.size)} @ {cents(f.price)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="muted small">
                    No executable trade: the cheapest YES + NO across venues costs more than $1 after fees.
                  </div>
                )}
              </div>
              <div>
                <h4>Check before trading</h4>
                <ul className="small">
                  {p.flags.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                  {p.llm && <li>LLM check: {p.llm.note}</li>}
                  <li>Resolution rules and sources can differ even when titles match.</li>
                </ul>
              </div>
              <div>
                <h4>Contracts</h4>
                <div className="small">
                  <a href={p.kalshi.url} target="_blank" rel="noreferrer">
                    Kalshi · {p.kalshi.id}
                  </a>
                  <br />
                  <a href={p.polymarket.url} target="_blank" rel="noreferrer">
                    Polymarket · {p.polymarket.title}
                  </a>
                  <br />
                  <span className="muted">
                    Fees: Kalshi {feeLabel(p.kalshi.fee.kind === "kalshi" ? p.kalshi.fee.coeff : 0)} · Polymarket{" "}
                    {feeLabel(p.polymarket.fee.kind === "polymarket" ? p.polymarket.fee.rate : 0)}
                  </span>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function feeLabel(coeff: number): string {
  return coeff > 0 ? `${+(coeff * 100).toFixed(2)}% × P(1−P)` : "none";
}

function fmtQty(x: number): string {
  return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

type Leg = { key: string; venue: string; side: string; size: number; avg: number; fills: { price: number; size: number }[] };

/** One block per leg (venue + side), price levels ascending, with the size-weighted average price. */
function groupFills(fills: { venue: string; side: string; price: number; size: number }[]): Leg[] {
  const legs = new Map<string, Leg>();
  for (const f of fills) {
    const key = `${f.venue}|${f.side}`;
    const leg = legs.get(key) ?? { key, venue: f.venue, side: f.side, size: 0, avg: 0, fills: [] };
    leg.fills.push({ price: f.price, size: f.size });
    leg.size += f.size;
    legs.set(key, leg);
  }
  for (const leg of legs.values()) {
    leg.fills.sort((a, b) => a.price - b.price);
    leg.avg = leg.fills.reduce((s, f) => s + f.price * f.size, 0) / leg.size;
  }
  return [...legs.values()];
}

function isStale(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t > 2 * 3600_000;
}
