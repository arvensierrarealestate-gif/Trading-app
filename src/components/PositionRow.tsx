"use client";

import { useEffect, useState } from "react";
import Sparkline from "./Sparkline";
import { aggressionColor, aggressionLabel, type TickerMetrics } from "@/lib/ticker";
import { computeStress, stressColor, type StressResult } from "@/lib/stress";
import type { SOP } from "@/lib/types";

type Position = {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string | null;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
};

export default function PositionRow({
  pos,
  sop,
  accountEquity,
}: {
  pos: Position;
  sop: SOP;
  accountEquity: number;
}) {
  const [closes, setCloses] = useState<number[] | null>(null);
  const [metrics, setMetrics] = useState<TickerMetrics | null>(null);
  const [stress, setStress] = useState<StressResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sp, tk] = await Promise.allSettled([
        fetch(`/api/sparkline?symbol=${encodeURIComponent(pos.symbol)}`).then((r) => r.json()),
        fetch(`/api/ticker?symbol=${encodeURIComponent(pos.symbol)}&fresh=1`).then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (sp.status === "fulfilled" && Array.isArray(sp.value.closes)) setCloses(sp.value.closes);
      if (tk.status === "fulfilled" && tk.value.metrics) {
        const m = tk.value.metrics as TickerMetrics;
        setMetrics(m);
        setStress(
          computeStress({
            position_value: Number(pos.market_value),
            beta: m.beta,
            worst_drawdown_pct: m.worst_drawdown_pct,
            account_equity: accountEquity,
            sop,
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pos.symbol, pos.market_value, accountEquity, sop]);

  const mv = Number(pos.market_value);
  const pl = Number(pos.unrealized_pl);
  const plPct = Number(pos.unrealized_plpc) * 100;
  const price = pos.current_price ? Number(pos.current_price) : null;
  const qty = Number(pos.qty);
  const up = pl >= 0;
  const aggr = metrics?.aggression_score;

  const styles: { label: string; ok: boolean; na?: boolean }[] = [
    { label: "SCALP", ok: !!metrics?.scalp_suitable },
    { label: "SWING", ok: !!metrics?.swing_suitable },
    { label: "CALLS", ok: false, na: true },
    { label: "PUTS", ok: false, na: true },
  ];

  return (
    <div className="position-row">
      <div className="pos-main">
        <div className="pos-left">
          <div className="pos-sym">{pos.symbol}</div>
          <div className="pos-qty">{qty.toLocaleString()} {Math.abs(qty) === 1 ? "share" : "shares"}</div>
        </div>

        <div className="pos-spark">{closes ? <Sparkline values={closes} /> : <div style={{ width: 96, height: 28 }} />}</div>

        <div className="pos-price">
          <div className="pos-price-now">{price != null ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}</div>
          {metrics?.atr_pct != null && <div className="pos-meta">ATR {metrics.atr_pct}%</div>}
        </div>

        <div className="pos-value">
          <div className="pos-value-now">${mv.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          <div className={`pos-pl ${up ? "up" : "down"}`}>
            {up ? "+" : ""}${pl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span className="pos-pl-pct"> ({up ? "+" : ""}{plPct.toFixed(2)}%)</span>
          </div>
        </div>

        <div className="pos-aggr">
          {aggr != null ? (
            <>
              <span className="aggr-label" style={{ color: aggressionColor(aggr) }}>{aggr}/10</span>
              <div className="aggr-bar"><div className="aggr-fill" style={{ width: `${aggr * 10}%`, background: aggressionColor(aggr) }} /></div>
              <span className="pos-meta">{aggressionLabel(aggr)}</span>
            </>
          ) : (
            <span className="pos-meta">…</span>
          )}
        </div>
      </div>

      <div className="pos-styles">
        {styles.map((s) => (
          <span key={s.label} className={`pill ${s.na ? "na" : s.ok ? "ok" : "no"}`}>{s.label}{s.na ? " n/a" : s.ok ? " ✓" : " ✕"}</span>
        ))}
      </div>

      {stress ? (
        <div className="pos-stress" style={{ borderColor: stressColor(stress.level) }}>
          <div className="stress-line">If market drops 10%: position loses <strong>${stress.loss_10pct.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
          <div className="stress-line">If market drops 20%: position loses <strong>${stress.loss_20pct.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong> <span className="pos-meta">({stress.pct_of_account_20.toFixed(2)}% of account)</span></div>
          {stress.worst_drawdown_pct != null && (
            <div className="stress-line pos-meta">Worst historical drawdown for this ticker: {stress.worst_drawdown_pct}%</div>
          )}
          <div className="stress-verdict" style={{ color: stressColor(stress.level) }}>
            {stress.level === "ok" && "✓ Within your SOP limits"}
            {stress.level === "warn" && "⚠ Approaching your daily loss limit"}
            {stress.level === "danger" && `✕ Exceeds your ${sop.drawdown} daily loss limit`}
          </div>
        </div>
      ) : (
        <div className="pos-stress muted">Computing stress test…</div>
      )}
    </div>
  );
}
