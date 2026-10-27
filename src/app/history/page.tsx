"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analysis } from "@/lib/history";
import { getJson } from "../fetch";
import { DIRECTION_LABEL, minutes, pct, shortDate, usd } from "../format";

const tooltipStyle = {
  background: "var(--bg)",
  border: "1px solid var(--line)",
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
      <h1>History</h1>
      <p>
        A GitHub Action runs the full scan every 30 minutes and saves the result. When a pair dips under $1, I track it
        until a later scan prices it and the gap is gone. The question is whether these gaps last long enough to trade.
      </p>

      {error && <p className="error">{error}</p>}
      {!data && !error && <div className="skeleton" />}

      {data && s && (
        <>
          <dl className="facts">
            <dt>{data.scans.toLocaleString()}</dt>
            <dd>scans so far with the current version of the scanner</dd>
            <dt>{s.pairsEverArbitrageable.toLocaleString()}</dt>
            <dd>of {s.pairsSeen.toLocaleString()} pairs were under $1 at least once</dd>
            <dt>{s.completed}</dt>
            <dd>gaps seen both opening and closing ({s.openNow} still open)</dd>
            <dt>{s.completed ? `${minutes(s.medianDurationMin)} to ${minutes(s.medianUpperMin)}` : "-"}</dt>
            <dd>median lifetime (lower and upper bound, since scans are 30 minutes apart)</dd>
            <dt>{pct(s.shareSingleScan, 0)}</dt>
            <dd>were gone by the next scan</dd>
          </dl>

          {data.scans < 4 ? (
            <p className="muted">
              Only {data.scans} scan{data.scans === 1 ? "" : "s"} so far. Charts show up after a few hours.
            </p>
          ) : (
            <>
              <h2>Pairs under $1, per scan</h2>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted)" }} minTickGap={48} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted)" }} width={36} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="linear" dataKey="opportunities" name="Pairs under $1" stroke="var(--text)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <h2>How long closed gaps lasted</h2>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.durationHistogram} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: "var(--muted)" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "var(--muted)" }} width={36} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--line)", opacity: 0.4 }} />
                    <Bar dataKey="count" name="Gaps" fill="var(--muted)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <h2>Biggest gaps</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Trade</th>
                  <th>First seen</th>
                  <th>Lasted at least</th>
                  <th className="n">Peak profit</th>
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
                    <td className="n pos">{usd(e.peakProfit)}</td>
                  </tr>
                ))}
                {!data.episodes.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No pair has been under $1 yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            A gap only counts as closed when a scan actually prices the pair and finds nothing. If a pair drops out of a
            scan or its order book fails to load, that&apos;s a hole in the data, not a close. Gaps already open at the
            first scan or still open at the last one are left out of the lifetime numbers.
          </p>
        </>
      )}
    </>
  );
}

/** Snapshot titles are "Event question: outcome". Show the outcome first unless it's just a date or Yes. */
function PairName({ title }: { title: string }) {
  const i = title.lastIndexOf(": ");
  if (i < 0) return <b>{title}</b>;
  const event = title.slice(0, i);
  const outcome = title.slice(i + 2);
  const generic = /^(before|by|in|on|after|until|yes|no)\b/i.test(outcome) || /^\d{4}$/.test(outcome.trim());
  return (
    <>
      <b>{generic ? event : outcome}</b>
      <br />
      <span className="muted">{generic ? outcome : event}</span>
    </>
  );
}
