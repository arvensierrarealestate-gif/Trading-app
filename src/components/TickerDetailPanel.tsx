"use client";

import { useEffect, useMemo, useState } from "react";
import { useTickerPanel } from "./TickerPanelContext";
import { aggressionColor, aggressionLabel, type TickerMetrics } from "@/lib/ticker";
import { computeConfidence } from "@/lib/confidence";
import { errorMessage } from "@/lib/errors";
import { isPaid, type SubscriptionInfo } from "@/lib/subscription";
import type { SOP } from "@/lib/types";
import ProGate from "./ProGate";

type Quote = {
  price: number | null;
  prev_close: number | null;
  day_high: number | null;
  day_low: number | null;
  volume: number | null;
  fifty_two_high: number | null;
  fifty_two_low: number | null;
  currency: string;
  closes: number[];
  bid: null;
  ask: null;
  open_interest: null;
};

const RANGES = ["1mo", "6mo", "1y"] as const;
type Range = (typeof RANGES)[number];

export default function TickerDetailPanel({
  sop,
  regime,
  subscription,
}: {
  sop: SOP;
  regime: string | null;
  subscription?: SubscriptionInfo;
}) {
  const { symbol, closeTicker } = useTickerPanel();
  const [metrics, setMetrics] = useState<TickerMetrics | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [range, setRange] = useState<Range>("1mo");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Order ticket
  const [qty, setQty] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderMsg, setOrderMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!symbol) return;
    setMetrics(null);
    setQuote(null);
    setErr(null);
    setOrderMsg(null);
    setQty("");
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [tk, qt] = await Promise.allSettled([
        fetch(`/api/ticker?symbol=${encodeURIComponent(symbol)}&fresh=1`).then((r) => r.json()),
        fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}&range=${range}`).then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (tk.status === "fulfilled" && tk.value.metrics) setMetrics(tk.value.metrics);
      if (qt.status === "fulfilled" && !qt.value.error) setQuote(qt.value);
      else if (qt.status === "fulfilled") setErr(qt.value.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") closeTicker();
    }
    if (symbol) window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [symbol, closeTicker]);

  const conf = useMemo(() => {
    if (!metrics) return null;
    return computeConfidence({
      symbol: symbol ?? "",
      aggression: metrics.aggression_score,
      atrPct: metrics.atr_pct ?? 0,
      beta: metrics.beta,
      worstDrawdownPct: metrics.worst_drawdown_pct,
      scalpSuitable: metrics.scalp_suitable,
      swingSuitable: metrics.swing_suitable,
      sop,
      regime,
    });
  }, [metrics, symbol, sop, regime]);

  if (!symbol) return null;

  const free = !isPaid(subscription);
  if (free) {
    return (
      <>
        <div className="td-scrim" onClick={closeTicker} />
        <aside className="td-panel" role="dialog" aria-label={`${symbol} detail`}>
          <div className="td-head">
            <div>
              <div className="td-sym">{symbol}</div>
              <div className="td-price">Ticker intelligence</div>
            </div>
            <button className="td-close" onClick={closeTicker} aria-label="Close">✕</button>
          </div>
          <div className="td-body" style={{ padding: 18 }}>
            <ProGate
              title="The ticker detail panel is a Pro tool"
              description="Live chart, day range, aggression score, gate dots, stress test, confidence match, and a one-click bracket-order ticket against your Alpaca account — built for active traders placing real money trades."
              onBack={closeTicker}
              backLabel="Close"
            />
          </div>
        </aside>
      </>
    );
  }

  const price = quote?.price ?? metrics?.price ?? null;
  const prev = quote?.prev_close ?? null;
  const chg = price != null && prev != null && prev !== 0 ? ((price - prev) / prev) * 100 : null;
  const dd = parseFloat(sop.drawdown) || 2;
  const beta = metrics?.beta ?? 1;

  async function submitOrder(side: "buy" | "sell") {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setOrderMsg({ ok: false, text: "Enter a quantity greater than 0." });
      return;
    }
    setOrderBusy(true);
    setOrderMsg(null);
    try {
      const res = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, side, type: "market", qty, time_in_force: "day" }),
      });
      const json = await res.json();
      if (!res.ok) setOrderMsg({ ok: false, text: json.error || "Order rejected" });
      else setOrderMsg({ ok: true, text: `${side === "buy" ? "Buy" : "Sell"} order submitted: ${json.order?.qty ?? qty} ${symbol} (${json.order?.status ?? "accepted"})` });
    } catch (e) {
      setOrderMsg({ ok: false, text: errorMessage(e, "Network error") });
    } finally {
      setOrderBusy(false);
    }
  }

  return (
    <>
      <div className="td-scrim" onClick={closeTicker} />
      <aside className="td-panel" role="dialog" aria-label={`${symbol} detail`}>
        <div className="td-head">
          <div>
            <div className="td-sym">{symbol}</div>
            {price != null && (
              <div className="td-price">
                ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                {chg != null && <span className={chg >= 0 ? "up" : "down"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}
              </div>
            )}
          </div>
          <button className="td-close" onClick={closeTicker} aria-label="Close">✕</button>
        </div>

        <div className="td-body">
          {loading && !metrics ? (
            <div className="td-loading">Loading {symbol}…</div>
          ) : (
            <>
              {/* Chart */}
              <div className="td-section">
                <div className="td-range-tabs">
                  {RANGES.map((r) => (
                    <button key={r} className={`range-tab ${r === range ? "active" : ""}`} onClick={() => setRange(r)} type="button">{r.toUpperCase()}</button>
                  ))}
                </div>
                {quote?.closes && quote.closes.length > 1 ? (
                  <MiniChart values={quote.closes} />
                ) : (
                  <div className="td-chart-empty">{err ?? "No chart data"}</div>
                )}
              </div>

              {/* Quote grid */}
              <div className="td-section">
                <div className="td-grid">
                  <Cell label="Day range" value={quote?.day_low != null && quote?.day_high != null ? `$${quote.day_low.toFixed(2)} – $${quote.day_high.toFixed(2)}` : "—"} />
                  <Cell label="52-week range" value={quote?.fifty_two_low != null && quote?.fifty_two_high != null ? `$${quote.fifty_two_low.toFixed(2)} – $${quote.fifty_two_high.toFixed(2)}` : "—"} />
                  <Cell label="Volume" value={quote?.volume != null ? quote.volume.toLocaleString() : "—"} />
                  <Cell label="ATR" value={metrics?.atr_pct != null ? `${metrics.atr_pct}%` : "—"} />
                  <Cell label="Bid / Ask" value="needs provider" muted />
                  <Cell label="Open interest" value="needs provider" muted />
                </div>
              </div>

              {/* Aggression + confidence */}
              {metrics && conf && (
                <div className="td-section">
                  <div className="td-section-label">Aggression &amp; fit</div>
                  <div className="aggr-row">
                    <span className="aggr-label" style={{ color: aggressionColor(metrics.aggression_score) }}>
                      {metrics.aggression_score}/10 · {aggressionLabel(metrics.aggression_score)}
                    </span>
                    <div className="aggr-bar"><div className="aggr-fill" style={{ width: `${metrics.aggression_score * 10}%`, background: aggressionColor(metrics.aggression_score) }} /></div>
                  </div>
                  <div className="td-confidence">
                    <span className="td-conf-val" style={{ color: conf.score >= 55 ? "var(--accent)" : conf.score >= 40 ? "var(--amber)" : "var(--red)" }}>{conf.score}%</span>
                    <span className="td-conf-label">match to your SOP</span>
                  </div>
                  {/* Gate dots */}
                  <div className="gate-dots">
                    {conf.gates.map((g) => (
                      <div key={g.label} className="gate-dot-item" title={g.label}>
                        <span className={`gate-dot ${g.pass ? "pass" : "fail"}`} />
                        <span className="gate-dot-label">{g.label}</span>
                      </div>
                    ))}
                  </div>
                  {conf.warning && <div className="td-warning">{conf.warning}</div>}
                </div>
              )}

              {/* Stress test */}
              {metrics && (
                <div className="td-section">
                  <div className="td-section-label">Stress test (beta {beta.toFixed(2)})</div>
                  <div className="td-stress-line">Market −5% → <strong>~{(beta * 5).toFixed(1)}%</strong> on this position</div>
                  <div className="td-stress-line">Market −10% → <strong>~{(beta * 10).toFixed(1)}%</strong></div>
                  <div className="td-stress-line" style={{ color: beta * 20 > dd * 3 ? "var(--red)" : "var(--text2)" }}>
                    Market −20% → <strong>~{(beta * 20).toFixed(1)}%</strong> {beta * 20 > dd * 3 ? `(above your ${sop.drawdown} daily limit)` : `(within tolerance)`}
                  </div>
                  {metrics.worst_drawdown_pct != null && (
                    <div className="td-stress-line pos-meta">Worst historical drawdown: {metrics.worst_drawdown_pct}%</div>
                  )}
                </div>
              )}

              {/* Trade styles */}
              {metrics && (
                <div className="td-section">
                  <div className="td-section-label">Trade style</div>
                  <div className="reco-pills">
                    <span className={`pill ${metrics.scalp_suitable ? "ok" : "no"}`}>SCALP {metrics.scalp_suitable ? "✓" : "✕"}</span>
                    <span className={`pill ${metrics.swing_suitable ? "ok" : "no"}`}>SWING {metrics.swing_suitable ? "✓" : "✕"}</span>
                    <span className="pill na">CALLS n/a</span>
                    <span className="pill na">PUTS n/a</span>
                  </div>
                  <div className="td-stub">Options strategy overlays (EMA/RSI/IV) need an options data provider.</div>
                </div>
              )}

              {/* News */}
              <div className="td-section">
                <div className="td-section-label">News</div>
                <div className="td-stub">Headlines require a news provider. Add a key to enable 5 headlines per ticker.</div>
              </div>

              {/* Trade ticket */}
              <div className="td-section">
                <div className="td-section-label">Paper trade (Alpaca)</div>
                <div className="td-order">
                  <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" min="0" />
                  <button className="btn" disabled={orderBusy} onClick={() => submitOrder("buy")} type="button">Buy to open</button>
                  <button className="btn" disabled={orderBusy} onClick={() => submitOrder("sell")} type="button">Sell to close</button>
                  <button className="btn" disabled title="Rolling needs an options provider" type="button">Roll</button>
                </div>
                {orderMsg && <div className={`td-order-msg ${orderMsg.ok ? "ok" : "err"}`}>{orderMsg.text}</div>}
                <div className="td-stub">Market orders to your paper account. &ldquo;Roll&rdquo; needs an options provider.</div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function Cell({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="td-cell">
      <div className="td-cell-label">{label}</div>
      <div className={`td-cell-val ${muted ? "muted" : ""}`}>{value}</div>
    </div>
  );
}

function MiniChart({ values }: { values: number[] }) {
  const w = 600;
  const h = 140;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 12) - 6).toFixed(1)}`);
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? "var(--accent)" : "var(--red)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" className="td-chart">
      <polyline fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" points={pts.join(" ")} strokeLinejoin="round" />
    </svg>
  );
}
