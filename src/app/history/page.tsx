"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analysis } from "@/lib/history";
import { getJson } from "../fetch";
import { DIRECTION_LABEL, minutes, pct, shortDate, usd } from "../format";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  fontFamily: "var(--font)",
  fontSize: 13,
};

export default function HistoryPage() {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<Analysis>("/api/history")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const s = data?.summary;
  const series = (data?.timeseries ?? []).map((p) => ({
    ...p,
    label: new Date(p.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" }),
  }));

  return (
    <>
      <h1>How long does an edge last?</h1>
      <p className="lede">
        A full scan runs every 30 minutes. When a pair costs less than $1 after fees, we follow it until a scan prices
        it again and the gap is gone.
      </p>

      {error && <div className="notice">{error}</div>}

      {!data && !error && (
        <div className="facts" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="fact" key={i}>
              <div className="skeleton" style={{ height: 30, width: "60%" }} />
              <div className="skeleton" style={{ marginTop: 8, width: "80%" }} />
            </div>
          ))}
        </div>
      )}

      {data && s && (
        <>
          <div className="facts">
            <Fact value={data.scans.toLocaleString()} label="scans logged with the current scanner" />
            <Fact value={s.pairsEverArbitrageable.toLocaleString()} label={`of ${s.pairsSeen.toLocaleString()} pairs ever under $1`} />
            <Fact value={`${s.completed}`} label={`edges seen open and close (${s.openNow} still open)`} />
            <Fact
              value={s.completed ? `${minutes(s.medianDurationMin)} to ${minutes(s.medianUpperMin)}` : "–"}
              label="median lifetime, lower to upper bound"
            />
            <Fact value={pct(s.shareSingleScan, 0)} label="gone by the next scan" />
          </div>

          {data.scans < 4 ? (
            <div className="notice">
              {data.scans} scan{data.scans === 1 ? "" : "s"} so far with the current scanner. Charts appear after a few
              hours of history.
            </div>
          ) : (
            <>
              <h2>Pairs under $1, per scan</h2>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--rule)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted)" }} minTickGap={48} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted)" }} width={36} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="opportunities" name="Pairs under $1" stroke="var(--edge)" dot={false} strokeWidth={2.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <h2>How long completed edges lasted</h2>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.durationHistogram} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--rule)" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: "var(--muted)" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted)" }} width={36} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--rule)", opacity: 0.4 }} />
                    <Bar dataKey="count" name="Edges" fill="var(--poly)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <h2>Largest edges</h2>
          <div className="table-scroll">
            <table className="plain-table">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Trade</th>
                  <th>First seen</th>
                  <th>Lasted at least</th>
                  <th>Peak profit</th>
                </tr>
              </thead>
              <tbody>
                {data.episodes.slice(0, 25).map((e) => (
                  <tr key={`${e.pairId}|${e.direction}|${e.start}`}>
                    <td>
                      <PairName title={e.title} />
                    </td>
                    <td className="muted">{DIRECTION_LABEL[e.direction] ?? e.direction}</td>
                    <td>{shortDate(e.start)}</td>
                    <td>
                      {e.observations === 1 ? "one scan" : minutes(e.durationMin)}
                      {e.censored === "right" || e.censored === "both" ? ", still open" : ""}
                    </td>
                    <td className="edge-pos">{usd(e.peakProfit)}</td>
                  </tr>
                ))}
                {!data.episodes.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No pair has cost less than $1 yet in this history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ maxWidth: "70ch" }}>
            An edge only ends when a scan prices the pair and finds no gap; a missing pair or failed order book is
            treated as a gap in the data. Edges already open at the first scan or still open at the last are left out of
            the lifetime figures.
          </p>
        </>
      )}
    </>
  );
}

/** Snapshot titles are "Event question: outcome"; show the outcome first, like the Live page. */
function PairName({ title }: { title: string }) {
  const i = title.lastIndexOf(": ");
  if (i < 0) return <strong style={{ fontWeight: 650 }}>{title}</strong>;
  const event = title.slice(0, i);
  const outcome = title.slice(i + 2);
  // A bare deadline or Yes says nothing on its own; lead with the question instead.
  const generic = /^(before|by|in|on|after|until|yes|no)\b/i.test(outcome) || /^\d{4}$/.test(outcome.trim());
  return (
    <>
      <strong style={{ fontWeight: 650 }}>{generic ? event : outcome}</strong>
      <br />
      <span className="muted">{generic ? outcome : event}</span>
    </>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="fact">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
