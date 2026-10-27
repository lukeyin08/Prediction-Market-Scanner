"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analysis } from "@/lib/history";
import { DIRECTION_LABEL, minutes, pct, shortDate, usd } from "../format";

export default function HistoryPage() {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/history")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        setData(d);
      })
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
        A scheduled job scans both venues every 30 minutes and logs every matched pair. An episode is a run of
        consecutive scans in which the same pair stayed profitable in the same direction. Durations are lower bounds: the
        edge may have opened or closed between scans.
      </p>

      {error && <div className="notice">{error}</div>}

      {data && (
        <>
          <div className="stats">
            <Stat label="Scans logged" value={data.scans.toLocaleString()} />
            <Stat label="Pairs tracked" value={s!.pairsSeen.toLocaleString()} />
            <Stat label="Ever arbitrageable" value={s!.pairsEverArbitrageable.toLocaleString()} />
            <Stat label="Episodes" value={s!.episodes.toLocaleString()} />
            <Stat label="Median lifetime" value={minutes(s!.medianDurationMin)} />
            <Stat label="Gone by next scan" value={pct(s!.shareSingleScan, 0)} />
          </div>
          {data.scans < 4 ? (
            <div className="notice">
              Collecting data: {data.scans} scan{data.scans === 1 ? "" : "s"} logged with the current matcher so far. The
              job runs every 30 minutes; charts appear once there are a few hours of history.
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
                  <th className="num">Lasted</th>
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
                    <td className="num">{e.observations === 1 ? "1 scan" : minutes(e.durationMin)}</td>
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
