"use client";

import { useEffect, useState } from "react";
import type { SOP } from "@/lib/types";
import { parseRegimes, type Regime } from "@/lib/regime";

const CONDITION: Record<Regime, { label: string; why: string; rec: string }> = {
  bull: {
    label: "favorable",
    why: "the market has been trending up steadily.",
    rec: "trade today with caution",
  },
  neutral: {
    label: "neutral",
    why: "the market is calm and moving sideways.",
    rec: "trade today with caution",
  },
  bear: {
    label: "avoid today",
    why: "the market has been drifting down.",
    rec: "wait for better conditions",
  },
  crash: {
    label: "avoid today",
    why: "the market is falling sharply and risk is high.",
    rec: "do not trade today",
  },
};

function pctToFraction(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n / 100 : 0.02;
}

export default function MorningBrief({ sop }: { sop: SOP }) {
  const [regime, setRegime] = useState<Regime | null>(null);
  const [equity, setEquity] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [regRes, acctRes] = await Promise.allSettled([
        fetch("/api/regime").then((r) => r.json()),
        fetch("/api/alpaca/account").then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (regRes.status === "fulfilled" && regRes.value?.current?.regime) setRegime(regRes.value.current.regime);
      if (acctRes.status === "fulfilled" && acctRes.value?.account?.equity) {
        const e = Number(acctRes.value.account.equity);
        if (Number.isFinite(e)) setEquity(e);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dailyLoss = pctToFraction(sop.drawdown);
  const maxLoss = equity != null ? equity * dailyLoss : null;
  const allowed = parseRegimes(sop.regimes);
  const cond = regime ? CONDITION[regime] : null;

  // Recommendation is gated on having the dollar figure.
  let recommendation = cond?.rec ?? null;
  if (cond && regime && (regime === "bull" || regime === "neutral") && allowed.length && !allowed.includes(regime)) {
    recommendation = "wait for better conditions";
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
            </div>

            {maxLoss != null && recommendation ? (
              <div className="brief-line">
                <span className="brief-key">Recommendation:</span> {recommendation}.
              </div>
            ) : maxLoss == null ? (
              <div className="brief-line muted">
                We&apos;ll show your trade recommendation once we can show your dollar risk alongside it.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
