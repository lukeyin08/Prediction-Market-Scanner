"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analysis } from "@/lib/history";
import { getJson } from "../fetch";
import { DIRECTION_LABEL, minutes, pct, shortDate, usd } from "../format";

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
      <h1>How long does the edge last?</h1>
      <p className="sub">
        A scheduled job scans both venues every 30 minutes and logs every matched pair. An episode is a run of scans in
        which the same pair stayed profitable in the same direction. It ends only when a scan prices the pair and finds
        no edge; a missing pair or failed order book counts as a gap. Lifetimes are bracketed: the lower bound is first
        to last profitable sighting, the upper bound is the flat scan before to the flat scan after. Episodes cut off by
        the start or end of the data are excluded from lifetime statistics.
      </p>

      {error && <div className="notice">{error}</div>}
      {!data && !error && (
        <div className="stats">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="stat" key={i}>
              <div className="skeleton" />
              <div className="skeleton" style={{ height: 28, marginTop: 8 }} />
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="stats">
            <Stat label="Scans logged" value={data.scans.toLocaleString()} />
            <Stat label="Pairs tracked" value={s!.pairsSeen.toLocaleString()} />
            <Stat label="Ever arbitrageable" value={s!.pairsEverArbitrageable.toLocaleString()} />
            <Stat label="Completed episodes" value={`${s!.completed} (${s!.openNow} open)`} />
            <Stat
              label="Median lifetime"
              value={s!.completed ? `${minutes(s!.medianDurationMin)} – ${minutes(s!.medianUpperMin)}` : "–"}
            />
            <Stat label="Gone by next scan" value={pct(s!.shareSingleScan, 0)} />
          </div>
          {data.scans < 4 ? (
            <div className="notice">
              Collecting data: {data.scans} scan{data.scans === 1 ? "" : "s"} logged with the current scanner version so
              far. The job runs every 30 minutes; charts appear once there are a few hours of history.
            </div>
          ) : (
            <>
          <p className="muted small">
            Logging since {data.firstScan ? new Date(data.firstScan).toLocaleString() : "–"}.
          </p>

          <h2>Opportunities per scan</h2>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} minTickGap={40} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} width={36} />
                <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)" }} />
                <Line type="monotone" dataKey="opportunities" name="Positive-edge pairs" stroke="var(--good)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <h2>Episode lifetime</h2>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.durationHistogram} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: "var(--muted)" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} width={36} />
                <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)" }} />
                <Bar dataKey="count" name="Episodes" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h2>Largest episodes</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Direction</th>
                  <th className="num">First seen</th>
                  <th className="num">Lasted (at least)</th>
                  <th className="num">Scans</th>
                  <th className="num">Peak profit</th>
                </tr>
              </thead>
              <tbody>
                {data.episodes.slice(0, 25).map((e) => (
                  <tr key={`${e.pairId}|${e.direction}|${e.start}`}>
                    <td>{e.title}</td>
                    <td className="small muted">{DIRECTION_LABEL[e.direction] ?? e.direction}</td>
                    <td className="num">{shortDate(e.start)}</td>
                    <td className="num">
                      {e.observations === 1 ? "1 scan" : minutes(e.durationMin)}
                      {e.censored === "right" || e.censored === "both" ? " (still open)" : ""}
                    </td>
                    <td className="num">{e.observations}</td>
                    <td className="num pos">{usd(e.peakProfit)}</td>
                  </tr>
                ))}
                {!data.episodes.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No episodes yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
