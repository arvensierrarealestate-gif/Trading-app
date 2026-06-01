"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import type { SOP } from "@/lib/types";

const INTERVALS = [
  { id: "5m", label: "Every 5 min", ms: 5 * 60 * 1000 },
  { id: "15m", label: "Every 15 min", ms: 15 * 60 * 1000 },
  { id: "1h", label: "Every 1 hour", ms: 60 * 60 * 1000 },
] as const;

type IntervalId = (typeof INTERVALS)[number]["id"];

type Signal = {
  symbol: string;
  direction: "BUY" | "WAIT";
  entry: number;
  stop: number;
  target: number;
  rsi: number;
  ema20: number;
  ema50: number;
  volume_ratio: number;
  atr_pct: number;
  reasons: string[];
  cross_recent: boolean;
};

function parseSymbols(assets: string): string[] {
  return Array.from(
    new Set(assets.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ).slice(0, 8);
}

export default function ScalpMonitor({ sop }: { sop: SOP }) {
  const symbols = useMemo(() => parseSymbols(sop.assets), [sop.assets]);
  const [symbol, setSymbol] = useState<string>(symbols[0] ?? "");
  const [interval, setInterval] = useState<IntervalId>("15m");
  const [running, setRunning] = useState(false);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [qty, setQty] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderMsg, setOrderMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timerRef = useRef<number | null>(null);

  async function fetchSignal() {
    if (!symbol) return;
    setErr(null);
    try {
      const res = await fetch(`/api/signal?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error || "Signal failed");
        return;
      }
      setSignal(j);
      setLastChecked(new Date());
    } catch (e) {
      setErr(errorMessage(e, "Network error"));
    }
  }

  useEffect(() => {
    if (!running) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    fetchSignal();
    const ms = INTERVALS.find((i) => i.id === interval)?.ms ?? 900000;
    timerRef.current = window.setInterval(fetchSignal, ms) as unknown as number;
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, interval, symbol]);

  async function placeOrder() {
    if (!signal || signal.direction !== "BUY") return;
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setOrderMsg({ ok: false, text: "Enter a quantity greater than 0." });
      return;
    }
    setPlacing(true);
    setOrderMsg(null);
    try {
      const res = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: signal.symbol,
          side: "buy",
          type: "market",
          qty: String(n),
          time_in_force: "day",
          stop_loss: signal.stop,
          take_profit: signal.target,
        }),
      });
      const j = await res.json();
      if (!res.ok) setOrderMsg({ ok: false, text: j.error || "Order rejected" });
      else
        setOrderMsg({
          ok: true,
          text: `Bracket order submitted: BUY ${n} ${signal.symbol} · auto-stop $${signal.stop} · target $${signal.target}`,
        });
    } catch (e) {
      setOrderMsg({ ok: false, text: errorMessage(e, "Network error") });
    } finally {
      setPlacing(false);
    }
  }

  const intervalLabel = INTERVALS.find((i) => i.id === interval)?.label ?? interval;

  return (
    <div className="scalp-wrap">
      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">⚡</div> Scalp monitor</div>
          <div className="card-meta">live momentum signals · you confirm every trade</div>
        </div>
        <div className="section-block">
          <div className="form-grid">
            <div className="field">
              <label>Symbol</label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {symbols.length === 0 ? (
                  <option value="">Add symbols to your SOP first</option>
                ) : (
                  symbols.map((s) => <option key={s}>{s}</option>)
                )}
              </select>
            </div>
            <div className="field">
              <label>Check interval</label>
              <select value={interval} onChange={(e) => setInterval(e.target.value as IntervalId)}>
                {INTERVALS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="btn-row">
            <span className="btn-hint">
              {running
                ? `Polling · last check ${lastChecked?.toLocaleTimeString() ?? "—"}`
                : "Tap Start to begin checking — runs while this tab is open."}
            </span>
            <button
              type="button"
              className={`btn ${running ? "" : "primary"}`}
              onClick={() => setRunning((r) => !r)}
              disabled={!symbol}
            >
              {running ? "Stop monitoring" : "Start monitoring"}
            </button>
          </div>
          {err && <div className="auth-msg err" style={{ marginTop: 8 }}>{err}</div>}
        </div>
      </div>

      {signal && (
        <div className={`card signal-card ${signal.direction === "BUY" ? "go" : "wait"}`}>
          <div className="card-header">
            <div className="card-title">
              <div className="card-title-icon">◉</div>
              {signal.symbol} — {signal.direction === "BUY" ? "BUY signal" : "Wait"}
            </div>
            <div className="card-meta">{intervalLabel.toLowerCase()}</div>
          </div>
          <div className="section-block">
            <div className="signal-grid">
              <div className="signal-cell"><span className="signal-k">Entry</span><strong>${signal.entry}</strong></div>
              <div className="signal-cell"><span className="signal-k">Auto-stop</span><strong style={{ color: "var(--red)" }}>${signal.stop}</strong></div>
              <div className="signal-cell"><span className="signal-k">Target (1:2)</span><strong style={{ color: "var(--accent)" }}>${signal.target}</strong></div>
              <div className="signal-cell"><span className="signal-k">RSI</span><strong>{signal.rsi}</strong></div>
              <div className="signal-cell"><span className="signal-k">ATR</span><strong>{signal.atr_pct}%</strong></div>
              <div className="signal-cell"><span className="signal-k">Volume</span><strong>{signal.volume_ratio}×</strong></div>
            </div>
            <ul className="signal-reasons">
              {signal.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            {signal.direction === "BUY" ? (
              <>
                <div className="signal-order">
                  <input
                    type="number"
                    placeholder="Qty"
                    min="0"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                  />
                  <button className="btn primary" type="button" onClick={placeOrder} disabled={placing}>
                    {placing ? "Placing…" : "Place buy + auto-stop"}
                  </button>
                </div>
                <div className="signal-foot">
                  Submits a bracket order to your Alpaca paper account: market buy + automatic stop at ${signal.stop} + take-profit at ${signal.target}.
                </div>
              </>
            ) : (
              <div className="signal-foot">Momentum conditions not met yet. Monitor will recheck on the next interval.</div>
            )}
            {orderMsg && (
              <div className={`auth-msg ${orderMsg.ok ? "ok" : "err"}`} style={{ marginTop: 10 }}>{orderMsg.text}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
