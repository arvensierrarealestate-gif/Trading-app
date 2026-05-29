"use client";

import { useEffect, useState } from "react";
import type { SOP, TradingMode, TraderStats } from "@/lib/types";
import { parseRegimes, type Regime } from "@/lib/regime";
import { aggressionColor, aggressionLabel, type TickerMetrics } from "@/lib/ticker";
import { useAcademy } from "./AcademyContext";

const CONDITION: Record<Regime, { label: string; why: string; rec: string }> = {
  bull: { label: "favorable", why: "the market has been trending up steadily.", rec: "trade today with caution" },
  neutral: { label: "neutral", why: "the market is calm and moving sideways.", rec: "trade today with caution" },
  bear: { label: "avoid today", why: "the market has been drifting down.", rec: "wait for better conditions" },
  crash: { label: "avoid today", why: "the market is falling sharply and risk is high.", rec: "do not trade today" },
};

function pctToFraction(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n / 100 : 0.02;
}

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
  if (mode === "trader") return <TraderBrief sop={sop} stats={stats} />;
  return <LearnerBrief sop={sop} />;
}

type StrategyBrief = {
  last_close: number;
  leaps: { recent_low: number; pct_above_low: number; at_support: boolean };
  momentum: { ema20: number; ema50: number; crossover_recent: boolean; ema20_above_ema50: boolean; volume_ratio: number; volume_high: boolean };
  premium_selling: { iv_rank_available: boolean; note: string };
};

function LearnerBrief({ sop }: { sop: SOP }) {
  const { openAcademy } = useAcademy();
  const [regime, setRegime] = useState<Regime | null>(null);
  const [equity, setEquity] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [strat, setStrat] = useState<StrategyBrief | null>(null);

  const strategyType = sop.strategy_type ?? "custom";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [regRes, acctRes, stratRes] = await Promise.allSettled([
        fetch("/api/regime").then((r) => r.json()),
        fetch("/api/alpaca/account").then((r) => r.json()),
        strategyType === "custom" ? Promise.resolve(null) : fetch("/api/strategy-brief").then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (regRes.status === "fulfilled" && regRes.value?.current?.regime) setRegime(regRes.value.current.regime);
      if (acctRes.status === "fulfilled" && acctRes.value?.account?.equity) {
        const e = Number(acctRes.value.account.equity);
        if (Number.isFinite(e)) setEquity(e);
      }
      if (stratRes.status === "fulfilled" && stratRes.value && !stratRes.value.error) setStrat(stratRes.value as StrategyBrief);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [strategyType]);

  const maxLoss = equity != null ? equity * pctToFraction(sop.drawdown) : null;
  const allowed = parseRegimes(sop.regimes);
  const cond = regime ? CONDITION[regime] : null;
  let recommendation = cond?.rec ?? null;
  if (cond && regime && (regime === "bull" || regime === "neutral") && allowed.length && !allowed.includes(regime)) {
    recommendation = "wait for better conditions";
  }

  // Strategy-specific brief copy.
  let strategyLine: React.ReactNode = null;
  if (strat) {
    if (strategyType === "premium-selling") {
      strategyLine = (
        <span className="muted">
          <span className="brief-key" style={{ color: "var(--amber)" }}>Premium selling brief:</span> {strat.premium_selling.note}
        </span>
      );
    } else if (strategyType === "leaps") {
      const { pct_above_low, at_support } = strat.leaps;
      strategyLine = (
        <>
          <span className="brief-key">LEAPS conditions:</span>{" "}
          SPY is {at_support ? "at" : pct_above_low > 0 ? "above" : "below"} weekly support
          {" "}({pct_above_low >= 0 ? "+" : ""}{pct_above_low.toFixed(1)}% from 8-week low).{" "}
          <strong>{at_support ? "Good entry conditions for LEAPS." : "Wait for a pullback to support."}</strong>
        </>
      );
    } else if (strategyType === "momentum-swing") {
      const { crossover_recent, ema20_above_ema50, volume_high, volume_ratio } = strat.momentum;
      const haveSignal = crossover_recent || ema20_above_ema50;
      strategyLine = (
        <>
          <span className="brief-key">Momentum conditions:</span>{" "}
          EMA crossover {crossover_recent ? "detected" : ema20_above_ema50 ? "active (20-EMA above 50-EMA)" : "not detected"} on SPY
          {" "}with {volume_high ? "high" : "low"} volume ({volume_ratio.toFixed(2)}× 20-day avg).{" "}
          <strong>{haveSignal && volume_high ? "Momentum conditions are favorable." : "Wait for a stronger momentum signal."}</strong>
        </>
      );
    }
  }

  return (
    <div className="card brief-card">
      <div className="card-header">
        <div className="card-title"><div className="card-title-icon">☀</div> Your morning brief</div>
        <div className="card-meta">protection first</div>
      </div>
      <div className="brief-body">
        {loading ? (
          <div className="brief-line muted">Putting together your brief…</div>
        ) : (
          <>
            <div className="brief-line">
              {maxLoss != null ? (
                <>
                  <span className="brief-key">Your maximum loss today</span> if all trades hit their stop loss:{" "}
                  <strong>${maxLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>{" "}
                  <span className="muted">(your {sop.drawdown} daily safety limit).</span>
                </>
              ) : (
                <span className="muted">Connect your paper account to see your maximum dollar loss for the day.</span>
              )}
            </div>
            <div className="brief-line">
              <span className="brief-key">Market conditions:</span>{" "}
              {cond ? <>{cond.label} — {cond.why}</> : <span className="muted">unavailable right now.</span>}
              {" "}
              <button type="button" className="brief-learn" onClick={() => openAcademy("market-regime")}>Learn →</button>
            </div>
            {strategyLine && <div className="brief-line">{strategyLine}</div>}
            {maxLoss != null && recommendation ? (
              <div className="brief-line">
                <span className="brief-key">Recommendation:</span> {recommendation}.
                {recommendation.startsWith("wait") || recommendation.startsWith("do not") ? (
                  <> <button type="button" className="brief-learn" onClick={() => openAcademy("market-regime")}>Why this gate?</button></>
                ) : null}
              </div>
            ) : maxLoss == null ? (
              <div className="brief-line muted">We&apos;ll show your trade recommendation once we can show your dollar risk alongside it.</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function TraderBrief({ sop, stats }: { sop: SOP; stats: TraderStats | null }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sop.assets]);

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
