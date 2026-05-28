"use client";

import { useEffect, useState } from "react";
import { aggressionColor, aggressionLabel, type TickerMetrics } from "@/lib/ticker";
import { errorMessage } from "@/lib/errors";
import type { SOP, TraderStats } from "@/lib/types";

export default function TickerCard({
  symbol,
  sop,
  stats,
  regime,
}: {
  symbol: string;
  sop: SOP;
  stats: TraderStats | null;
  regime: string | null;
}) {
  const [m, setM] = useState<TickerMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setM(null);
      setErr(null);
      setInsight(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setInsight(null);
    (async () => {
      try {
        const res = await fetch(`/api/ticker?symbol=${encodeURIComponent(sym)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setErr(json.error || "No data");
          setM(null);
          return;
        }
        setM(json.metrics);
        // Personalized insight (best-effort).
        fetch("/api/ticker-insight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: sym,
            aggression_score: json.metrics.aggression_score,
            atr_pct: json.metrics.atr_pct,
            beta: json.metrics.beta,
            scalp_suitable: json.metrics.scalp_suitable,
            swing_suitable: json.metrics.swing_suitable,
            sop: { regimes: sop.regimes, tf: sop.tf, assets: sop.assets },
            stats,
            regime,
          }),
        })
          .then((r) => r.json())
          .then((j) => !cancelled && setInsight(j.insight || null))
          .catch(() => {});
      } catch (e) {
        if (!cancelled) setErr(errorMessage(e, "Network error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, sop.regimes, sop.tf, sop.assets, stats, regime]);

  if (!symbol.trim()) return null;

  return (
    <div className="ticker-card">
      <div className="ticker-card-head">
        <span className="ticker-sym">{symbol.trim().toUpperCase()}</span>
        {loading && <span className="ticker-meta">loading…</span>}
        {err && <span className="ticker-meta" style={{ color: "var(--red)" }}>{err}</span>}
        {m?.price != null && <span className="ticker-meta">${m.price}</span>}
      </div>

      {m && (
        <>
          <div className="aggr-row">
            <span className="aggr-label" style={{ color: aggressionColor(m.aggression_score) }}>
              {m.aggression_score}/10 · {aggressionLabel(m.aggression_score)}
            </span>
            <div className="aggr-bar">
              <div className="aggr-fill" style={{ width: `${m.aggression_score * 10}%`, background: aggressionColor(m.aggression_score) }} />
            </div>
            <span className="ticker-meta">ATR {m.atr_pct}% · β {m.beta}</span>
          </div>

          <div className="style-badges">
            <StyleBadge label="SCALP" ok={m.scalp_suitable} detail={`Avg scalp window ≈ ${m.scalp_window_min} min (est. from intraday range)`} />
            <StyleBadge label="SWING" ok={m.swing_suitable} detail={`Avg swing ≈ ${m.swing_duration_days} days (est. from 6mo price action)`} />
            <StyleBadge label="CALLS" unavailable detail="IV rank unavailable — needs options provider" />
            <StyleBadge label="PUTS" unavailable detail="Put/call ratio unavailable — needs options provider" />
          </div>

          {insight && <div className="ticker-insight">{insight}</div>}
        </>
      )}
    </div>
  );
}

function StyleBadge({ label, ok, unavailable, detail }: { label: string; ok?: boolean; unavailable?: boolean; detail: string }) {
  const cls = unavailable ? "na" : ok ? "ok" : "no";
  return (
    <div className={`style-badge ${cls}`} title={detail}>
      <div className="style-badge-label">{label} {unavailable ? "n/a" : ok ? "✓" : "✕"}</div>
      <div className="style-badge-detail">{detail}</div>
    </div>
  );
}
