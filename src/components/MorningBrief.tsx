"use client";

import { useCallback, useEffect, useState } from "react";
import type { SOP, TradingMode, TraderStats } from "@/lib/types";
import { aggressionColor, aggressionLabel, type TickerMetrics } from "@/lib/ticker";

type DBBrief = {
  id: string;
  generated_at: string;
  date: string;
  regime: string | null;
  regime_confidence: number | null;
  gates_passing: number | null;
  strategy_signal: string | null;
  recommendation: string | null;
  full_brief: string | null;
};

function parseSymbols(assets: string): string[] {
  return Array.from(
    new Set(
      assets
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, 6);
}

export default function MorningBrief({ sop, mode, stats }: { sop: SOP; mode: TradingMode; stats: TraderStats | null }) {
  return (
    <>
      <AutomatedBrief />
      {mode === "trader" && <TraderWatchlist sop={sop} stats={stats} />}
    </>
  );
}

function AutomatedBrief() {
  const [brief, setBrief] = useState<DBBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/morning-brief/latest");
      const j = await res.json();
      if (res.ok) setBrief(j.brief);
    } finally {
      setLoading(false);
    }
  }, []);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/morning-brief/generate", { method: "POST" });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Could not generate brief");
        return;
      }
      setBrief(j.brief as DBBrief);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  const generatedTime = brief?.generated_at
    ? new Date(brief.generated_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="card brief-card">
      <div className="card-header">
        <div className="card-title"><div className="card-title-icon">☀</div> Your morning brief</div>
        <div className="card-meta">
          {generatedTime ? (
            <>Generated today at {generatedTime} · <button type="button" className="brief-learn" onClick={generate} disabled={generating}>{generating ? "Refreshing…" : "↻ Regenerate"}</button></>
          ) : (
            <span>protection first</span>
          )}
        </div>
      </div>
      <div className="brief-body">
        {loading ? (
          <div className="brief-line muted">Loading your brief…</div>
        ) : brief?.full_brief ? (
          <div className="brief-markdown">{renderMarkdown(brief.full_brief)}</div>
        ) : (
          <div className="brief-empty">
            <div className="brief-line muted">No brief for today yet. Generate one now or wait for the 7:30 AM ET auto-brief.</div>
            <button type="button" className="btn primary" onClick={generate} disabled={generating} style={{ marginTop: 10 }}>
              {generating ? "Generating…" : "Generate now"}
            </button>
          </div>
        )}
        {error && <div className="brief-line" style={{ color: "var(--red)" }}>{error}</div>}
      </div>
    </div>
  );
}

// Minimal markdown renderer for the 6-section brief — handles ##, **, lists.
// Avoids pulling in a markdown lib just for this surface.
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = () => {
    if (!listBuf.length) return;
    out.push(
      <ul key={`ul-${out.length}`}>
        {listBuf.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>,
    );
    listBuf = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      out.push(<h4 key={`h-${out.length}`} className="brief-h">{line.slice(3)}</h4>);
    } else if (line.startsWith("- ")) {
      listBuf.push(line.slice(2));
    } else {
      flushList();
      out.push(<p key={`p-${out.length}`} className="brief-p">{renderInline(line)}</p>);
    }
  }
  flushList();
  return out;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>,
  );
}

function TraderWatchlist({ sop, stats }: { sop: SOP; stats: TraderStats | null }) {
  const symbols = parseSymbols(sop.assets);
  const [rows, setRows] = useState<Record<string, TickerMetrics | { error: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        symbols.map(async (sym) => {
          try {
            const res = await fetch(`/api/ticker?symbol=${encodeURIComponent(sym)}`);
            const json = await res.json();
            return [sym, res.ok ? (json.metrics as TickerMetrics) : { error: json.error || "no data" }] as const;
          } catch {
            return [sym, { error: "network" }] as const;
          }
        }),
      );
      if (cancelled) return;
      setRows(Object.fromEntries(entries));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sop.assets, symbols]);

  function bestStyle(m: TickerMetrics): string {
    if (m.scalp_suitable && m.swing_suitable) return "scalp / swing";
    if (m.scalp_suitable) return "scalp";
    if (m.swing_suitable) return "swing";
    return "wait — choppy";
  }

  return (
    <div className="card brief-card">
      <div className="card-header">
        <div className="card-title"><div className="card-title-icon">☰</div> Watchlist intelligence</div>
        <div className="card-meta">{symbols.length} symbols · price-derived</div>
      </div>
      {symbols.length === 0 ? (
        <div className="empty-state"><div>No symbols in your SOP watchlist</div></div>
      ) : loading ? (
        <div className="empty-state"><div>Scanning your watchlist…</div></div>
      ) : (
        <div className="watch-list">
          {symbols.map((sym) => {
            const m = rows[sym];
            if (!m || "error" in (m as object)) {
              return (
                <div key={sym} className="watch-row">
                  <span className="watch-sym">{sym}</span>
                  <span className="ticker-meta" style={{ color: "var(--red)" }}>{(m as { error: string })?.error ?? "no data"}</span>
                </div>
              );
            }
            const tm = m as TickerMetrics;
            const aggressiveRisk = tm.aggression_score >= 9;
            return (
              <div key={sym} className="watch-row">
                <span className="watch-sym">{sym}</span>
                <span className="aggr-chip" style={{ color: aggressionColor(tm.aggression_score), borderColor: aggressionColor(tm.aggression_score) }}>
                  {tm.aggression_score}/10 {aggressionLabel(tm.aggression_score)}
                </span>
                <span className="watch-style">{bestStyle(tm)}</span>
                <span className="ticker-meta">ATR {tm.atr_pct}% · β {tm.beta}</span>
                {aggressiveRisk && (
                  <span className="watch-warn">
                    Highly aggressive. {stats?.max_single_loss != null ? `Your worst single loss was ${stats.max_single_loss}% — proceed with extra caution or skip today.` : "Proceed with extra caution or skip today."}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
