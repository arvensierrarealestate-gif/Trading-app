"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { aggressionColor, type TickerMetrics } from "@/lib/ticker";
import { computeConfidence, type ConfidenceResult } from "@/lib/confidence";
import type { SOP } from "@/lib/types";

type Row = ConfidenceResult & { metrics: TickerMetrics };

function parseSymbols(assets: string): string[] {
  return Array.from(
    new Set(
      assets
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        // Yahoo wants crypto pairs as BTC-USD, not BTC/USD.
        .map((s) => s.replace("/", "-")),
    ),
  );
}

export default function RecommendationsPanel({ sop, regime }: { sop: SOP; regime: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Candidate universe: SOP watchlist assets + saved watchlist table.
        const symbols = parseSymbols(sop.assets);
        try {
          const { data } = await supabase.from("watchlist").select("symbol");
          for (const w of data ?? []) {
            const s = String(w.symbol).trim().toUpperCase().replace("/", "-");
            if (s && !symbols.includes(s)) symbols.push(s);
          }
        } catch {
          /* watchlist optional */
        }
        const candidates = symbols.slice(0, 8);
        if (candidates.length === 0) {
          if (!cancelled) setRows([]);
          return;
        }

        const results = await Promise.all(
          candidates.map(async (sym) => {
            try {
              const res = await fetch(`/api/ticker?symbol=${encodeURIComponent(sym)}`);
              const json = await res.json();
              if (!res.ok || !json.metrics) return null;
              const m = json.metrics as TickerMetrics;
              const conf = computeConfidence({
                symbol: sym,
                aggression: m.aggression_score,
                beta: m.beta,
                worstDrawdownPct: m.worst_drawdown_pct,
                scalpSuitable: m.scalp_suitable,
                swingSuitable: m.swing_suitable,
                sop,
                regime,
              });
              return { ...conf, metrics: m } as Row;
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        setRows(results.filter((r): r is Row => r !== null).sort((a, b) => b.score - a.score));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load recommendations");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sop.assets, sop.risk, sop.drawdown, sop.tf, sop.regimes, regime]);

  const recommended = (rows ?? []).filter((r) => r.recommended).slice(0, 8);
  const notRecommended = (rows ?? []).filter((r) => !r.recommended).slice(0, 5);

  return (
    <div className="reco-rail">
      <div className="dash-card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">★</div> Recommended</div>
          <div className="card-meta">matched to your SOP</div>
        </div>
        <div className="reco-list">
          {rows === null ? (
            <div className="reco-empty">Scanning your watchlist…</div>
          ) : err ? (
            <div className="reco-empty" style={{ color: "var(--red)" }}>{err}</div>
          ) : recommended.length === 0 ? (
            <div className="reco-empty">No tickers clear your SOP threshold right now.</div>
          ) : (
            recommended.map((r) => <RecoCard key={r.symbol} row={r} />)
          )}
        </div>
      </div>

      {notRecommended.length > 0 && (
        <div className="dash-card">
          <div className="card-header">
            <div className="card-title"><div className="card-title-icon">⚠</div> Not recommended today</div>
          </div>
          <div className="reco-list">
            {notRecommended.map((r) => (
              <div key={r.symbol} className="reco-card danger">
                <div className="reco-card-head">
                  <span className="reco-sym">{r.symbol}</span>
                  <span className="reco-match" style={{ color: "var(--red)" }}>Risk match: {r.score}%</span>
                </div>
                <div className="reco-warning">{r.warning ?? "Outside your SOP parameters."}</div>
                <div className="reco-match-sub">Outside your SOP parameters</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RecoCard({ row }: { row: Row }) {
  const m = row.metrics;
  const styles = [
    m.scalp_suitable ? "scalp" : null,
    m.swing_suitable ? "swing" : null,
  ].filter(Boolean) as string[];
  return (
    <div className="reco-card">
      <div className="reco-card-head">
        <span className="reco-sym">{row.symbol}</span>
        <span className="reco-match">{row.score}% match</span>
      </div>
      <div className="aggr-row">
        <span className="aggr-label" style={{ color: aggressionColor(m.aggression_score) }}>{m.aggression_score}/10</span>
        <div className="aggr-bar"><div className="aggr-fill" style={{ width: `${m.aggression_score * 10}%`, background: aggressionColor(m.aggression_score) }} /></div>
      </div>
      <div className="reco-why">{row.reason}</div>
      {row.survivesStress && <div className="reco-stress-badge">Survives a 20% market drop within your risk tolerance</div>}
      <div className="reco-pills">
        {styles.length > 0 ? styles.map((s) => <span key={s} className="pill ok">{s.toUpperCase()} ✓</span>) : <span className="pill no">choppy</span>}
        <span className="pill na">CALLS n/a</span>
        <span className="pill na">PUTS n/a</span>
      </div>
    </div>
  );
}
