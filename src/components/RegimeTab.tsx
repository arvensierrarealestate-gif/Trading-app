"use client";

import { useEffect, useState } from "react";
import {
  REGIMES,
  REGIME_COLORS,
  REGIME_LABELS,
  type Regime,
  type RegimeResponse,
} from "@/lib/regime";
import type { TradingMode } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

const PLAIN: Record<Regime, string> = {
  crash: "Falling sharply — high risk right now",
  bear: "Trending down",
  neutral: "Calm and sideways",
  bull: "Trending up",
};

export default function RegimeTab({
  sopRegimes,
  onRegime,
  mode,
}: {
  sopRegimes: Regime[];
  onRegime: (r: Regime | null) => void;
  mode: TradingMode;
}) {
  const learner = mode === "learner";
  const [data, setData] = useState<RegimeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/regime");
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || "Could not load regime");
        onRegime(null);
      } else {
        setData(json);
        onRegime(json.current.regime);
      }
    } catch (e) {
      setErr(errorMessage(e, "Network error"));
      onRegime(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = data?.current.regime ?? null;
  const matches = current ? sopRegimes.includes(current) : false;
  const color = current ? REGIME_COLORS[current] : "var(--text3)";

  return (
    <div className="card regime-card">
      <div className="card-header">
        <div className="card-title">
          <div className="card-title-icon">◴</div> {learner ? "Market conditions · SPY" : "Market regime · SPY"}
          <span className="card-meta" style={{ marginLeft: 8 }}>
            {learner ? "last 90 days" : "4-state Gaussian HMM · 90d"}
          </span>
        </div>
        <button className="btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={load} type="button" disabled={loading}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><div>Training regime model…</div></div>
      ) : err ? (
        <div className="empty-state">
          <div>Could not estimate regime</div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>{err}</div>
        </div>
      ) : data ? (
        <>
          <div className="regime-head">
            <div className="regime-now" style={{ borderColor: color }}>
              <div className="regime-now-label" style={{ color }}>{REGIME_LABELS[current!]}</div>
              <div className="regime-now-conf">
                {learner ? PLAIN[current!] : `${Math.round(data.current.confidence * 100)}% confidence`}
              </div>
            </div>
            <div className="regime-meta">
              <div className="regime-asof">as of {data.asOf}</div>
              <div className={`regime-match ${matches ? "ok" : "blocked"}`}>
                {sopRegimes.length === 0
                  ? "No regime filter set in your SOP"
                  : matches
                  ? "✓ Matches your SOP — gates active"
                  : "✕ Outside your SOP regimes — setups blocked"}
              </div>
            </div>
          </div>

          <div className="regime-timeline-wrap">
            <div className="regime-timeline">
              {data.timeline.map((p, i) => (
                <div
                  key={i}
                  className="regime-seg"
                  style={{ background: REGIME_COLORS[p.regime] }}
                  title={`${p.date} · ${REGIME_LABELS[p.regime]} · ${p.return > 0 ? "+" : ""}${p.return}%`}
                />
              ))}
            </div>
            <div className="regime-timeline-axis">
              <span>{data.timeline[0]?.date}</span>
              <span>{data.timeline[data.timeline.length - 1]?.date}</span>
            </div>
          </div>

          <div className="regime-legend">
            {REGIMES.map((r) => (
              <div key={r} className="regime-legend-item">
                <span className="regime-dot" style={{ background: REGIME_COLORS[r] }} />
                <span>{REGIME_LABELS[r]}</span>
                {!learner && (
                  <span className="regime-legend-mean">
                    {data.means[r] > 0 ? "+" : ""}{data.means[r]}% avg
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
