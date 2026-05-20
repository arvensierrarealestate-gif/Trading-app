"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GL_ITEMS } from "@/lib/types";
import type { Trade } from "@/lib/types";

type AlpacaAccount = {
  account_number: string;
  status: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  buying_power: string;
};

type AlpacaOrder = {
  id: string;
  symbol: string;
  qty: string | null;
  filled_qty: string;
  side: string;
  type: string;
  time_in_force: string;
  limit_price: string | null;
  status: string;
  submitted_at: string;
  filled_avg_price: string | null;
};

type AlpacaPosition = {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string | null;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
};

type Ticket = {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: string;
  time_in_force: "day" | "gtc" | "ioc" | "fok";
  limit_price: string;
};

const EMPTY_TICKET: Ticket = {
  symbol: "",
  side: "buy",
  type: "market",
  qty: "",
  time_in_force: "day",
  limit_price: "",
};

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s === "filled") return "os-filled";
  if (["canceled", "expired", "rejected", "done_for_day"].includes(s)) return "os-dead";
  return "os-open";
}

export default function Stage3GoLive({
  trades,
  manualChecks,
  onManualChecksChange,
  onBack,
}: {
  trades: Trade[];
  manualChecks: boolean[];
  onManualChecksChange: (next: boolean[]) => void;
  onBack: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [account, setAccount] = useState<AlpacaAccount | null>(null);
  const [acctErr, setAcctErr] = useState<string | null>(null);
  const [acctLoading, setAcctLoading] = useState(true);

  const [orders, setOrders] = useState<AlpacaOrder[]>([]);
  const [ordersErr, setOrdersErr] = useState<string | null>(null);

  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [posErr, setPosErr] = useState<string | null>(null);
  const [closing, setClosing] = useState<AlpacaPosition | null>(null);
  const [closingBusy, setClosingBusy] = useState(false);

  const [ticket, setTicket] = useState<Ticket>(EMPTY_TICKET);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/alpaca/account");
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) setAcctErr(json.error || "Alpaca request failed");
        else setAccount(json.account);
      } catch (e) {
        if (!cancelled) setAcctErr(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled) setAcctLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/alpaca/orders");
      const json = await res.json();
      if (!res.ok) setOrdersErr(json.error || "Could not load orders");
      else {
        setOrders(json.orders ?? []);
        setOrdersErr(null);
      }
    } catch (e) {
      setOrdersErr(e instanceof Error ? e.message : "Network error");
    }
  }, []);

  const loadPositions = useCallback(async () => {
    try {
      const res = await fetch("/api/alpaca/positions");
      const json = await res.json();
      if (!res.ok) setPosErr(json.error || "Could not load positions");
      else {
        setPositions(json.positions ?? []);
        setPosErr(null);
      }
    } catch (e) {
      setPosErr(e instanceof Error ? e.message : "Network error");
    }
  }, []);

  const n = trades.length;
  const avg = n ? Math.round(trades.reduce((a, t) => a + t.score, 0) / n) : 0;
  const autoVals = { trades5: n >= 5, score70: avg >= 70 };

  const allChecks = GL_ITEMS.map((item, i) => {
    if (item.auto) {
      const key = item.key as "trades5" | "score70";
      return autoVals[key];
    }
    return manualChecks[i - 2] ?? false;
  });

  const total = GL_ITEMS.length;
  const done = allChecks.filter(Boolean).length;
  const allPassed = done === total;

  useEffect(() => {
    if (allPassed) {
      loadOrders();
      loadPositions();
    }
  }, [allPassed, loadOrders, loadPositions]);

  async function toggle(i: number) {
    const item = GL_ITEMS[i];
    if (item.auto) return;
    const idx = i - 2;
    const next = manualChecks.slice();
    next[idx] = !next[idx];
    onManualChecksChange(next);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("go_live_checks").upsert({
        user_id: user.id,
        manual_checks: next,
        updated_at: new Date().toISOString(),
      });
    }
  }

  function review() {
    setFormErr(null);
    setResult(null);
    if (!ticket.symbol.trim()) return setFormErr("Enter a symbol (e.g. BTC/USD or AAPL).");
    const qty = Number(ticket.qty);
    if (!Number.isFinite(qty) || qty <= 0) return setFormErr("Quantity must be a positive number.");
    if (ticket.type === "limit") {
      const lp = Number(ticket.limit_price);
      if (!Number.isFinite(lp) || lp <= 0) return setFormErr("Enter a valid limit price.");
    }
    setConfirming(true);
  }

  async function submitOrder() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/alpaca/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: ticket.symbol,
          side: ticket.side,
          type: ticket.type,
          qty: ticket.qty,
          time_in_force: ticket.time_in_force,
          limit_price: ticket.type === "limit" ? ticket.limit_price : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult({ kind: "err", msg: json.error || "Order rejected" });
      } else {
        setResult({ kind: "ok", msg: `Order submitted: ${json.order.side} ${json.order.qty} ${json.order.symbol} (${json.order.status})` });
        setTicket(EMPTY_TICKET);
        loadOrders();
        loadPositions();
      }
    } catch (e) {
      setResult({ kind: "err", msg: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }

  async function closePosition() {
    if (!closing) return;
    setClosingBusy(true);
    try {
      const res = await fetch(`/api/alpaca/positions?symbol=${encodeURIComponent(closing.symbol)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) setResult({ kind: "err", msg: json.error || "Could not close position" });
      else {
        setResult({ kind: "ok", msg: `Submitted close for ${closing.symbol}` });
        loadPositions();
        loadOrders();
      }
    } catch (e) {
      setResult({ kind: "err", msg: e instanceof Error ? e.message : "Network error" });
    } finally {
      setClosingBusy(false);
      setClosing(null);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">🚀</div> Go-live readiness checklist</div>
          <div className="card-meta">{done} / {total} complete</div>
        </div>

        <div className="checklist">
          {GL_ITEMS.map((item, i) => {
            const checked = allChecks[i];
            return (
              <div
                key={i}
                className={`check-item ${item.auto ? "auto-check" : ""}`}
                onClick={() => toggle(i)}
              >
                <div className={`checkbox ${checked ? "checked" : ""}`}>{checked ? "✓" : ""}</div>
                <div className={`check-text ${checked ? "checked" : ""}`}>{item.text}</div>
                <span className={`check-tag ${item.tagClass}`}>{item.tag}</span>
              </div>
            );
          })}
        </div>

        <div className="verdict-bar">
          <div className={`verdict-pill ${allPassed ? "execute" : "pending"}`}>
            {allPassed ? "Ready to trade live" : `${done}/${total} checks done`}
          </div>
          <div className="score-pips">
            {allChecks.map((c, i) => <div key={i} className={`pip ${c ? "pass" : ""}`} />)}
          </div>
          <span style={{ fontSize: 12, color: allPassed ? "var(--accent)" : "var(--text3)", marginLeft: 8 }}>
            {allPassed
              ? "All checks passed. Your system is tested, your rules are set. Trade with confidence."
              : `${total - done} item${total - done === 1 ? "" : "s"} remaining before you are ready to go live.`}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">$</div> Alpaca paper account</div>
          <div className="card-meta">paper-api.alpaca.markets</div>
        </div>
        {acctLoading ? (
          <div className="empty-state"><div>Loading account…</div></div>
        ) : acctErr ? (
          <div className="empty-state">
            <div>Could not load account</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{acctErr}</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
              Add <code>ALPACA_KEY_ID</code> and <code>ALPACA_SECRET_KEY</code> to your environment.
            </div>
          </div>
        ) : account ? (
          <div className="acct-grid">
            <div className="acct-cell"><div className="acct-label">Account</div><div className="acct-val">{account.account_number}</div></div>
            <div className="acct-cell"><div className="acct-label">Status</div><div className="acct-val">{account.status}</div></div>
            <div className="acct-cell"><div className="acct-label">Equity</div><div className="acct-val">${Number(account.equity).toLocaleString()}</div></div>
            <div className="acct-cell"><div className="acct-label">Cash</div><div className="acct-val">${Number(account.cash).toLocaleString()}</div></div>
            <div className="acct-cell"><div className="acct-label">Buying power</div><div className="acct-val">${Number(account.buying_power).toLocaleString()}</div></div>
            <div className="acct-cell"><div className="acct-label">Portfolio</div><div className="acct-val">${Number(account.portfolio_value).toLocaleString()}</div></div>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">⚡</div> Place live order</div>
          <div className="card-meta">{allPassed ? "paper trading account" : "complete the checklist to unlock"}</div>
        </div>

        {!allPassed ? (
          <div className="empty-state">
            <div className="empty-icon">🔒</div>
            <div>Order entry locked</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>Finish all {total} readiness checks to enable live orders.</div>
          </div>
        ) : (
          <>
            <div className="section-block">
              <div className="form-grid three">
                <div className="field">
                  <label>Symbol</label>
                  <input
                    type="text"
                    value={ticket.symbol}
                    onChange={(e) => setTicket({ ...ticket, symbol: e.target.value })}
                    placeholder="BTC/USD or AAPL"
                  />
                </div>
                <div className="field">
                  <label>Side</label>
                  <select value={ticket.side} onChange={(e) => setTicket({ ...ticket, side: e.target.value as Ticket["side"] })}>
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </div>
                <div className="field">
                  <label>Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={ticket.qty}
                    onChange={(e) => setTicket({ ...ticket, qty: e.target.value })}
                    placeholder="1"
                  />
                </div>
              </div>
              <div className="form-grid three">
                <div className="field">
                  <label>Order type</label>
                  <select value={ticket.type} onChange={(e) => setTicket({ ...ticket, type: e.target.value as Ticket["type"] })}>
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                  </select>
                </div>
                <div className="field">
                  <label>Time in force</label>
                  <select value={ticket.time_in_force} onChange={(e) => setTicket({ ...ticket, time_in_force: e.target.value as Ticket["time_in_force"] })}>
                    <option value="day">Day</option>
                    <option value="gtc">GTC</option>
                    <option value="ioc">IOC</option>
                    <option value="fok">FOK</option>
                  </select>
                </div>
                <div className="field">
                  <label>Limit price</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={ticket.limit_price}
                    disabled={ticket.type !== "limit"}
                    onChange={(e) => setTicket({ ...ticket, limit_price: e.target.value })}
                    placeholder={ticket.type === "limit" ? "67,450" : "—"}
                  />
                </div>
              </div>
            </div>

            <div className="btn-row">
              <span className="btn-hint">Submits a real order to your Alpaca paper account.</span>
              {formErr && <span className="btn-hint" style={{ color: "var(--red)", flex: "initial" }}>{formErr}</span>}
              <button className="btn primary" onClick={review} type="button">Review order →</button>
            </div>

            {result && (
              <div className="log-strip">
                <div className="log-line">
                  <span className={`log-badge ${result.kind === "ok" ? "lb-ok" : "lb-err"}`}>{result.kind === "ok" ? "ok" : "err"}</span>
                  <span>{result.msg}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {allPassed && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><div className="card-title-icon">◧</div> Open positions</div>
            <button className="btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={loadPositions} type="button">↻ Refresh</button>
          </div>
          {posErr ? (
            <div className="empty-state"><div>Could not load positions</div><div style={{ fontSize: 11, color: "var(--text3)" }}>{posErr}</div></div>
          ) : positions.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">◧</div><div>No open positions</div></div>
          ) : (
            <div>
              <div className="pos-row header">
                <span>symbol</span><span>qty</span><span>avg entry</span><span>unrealized p/l</span><span></span>
              </div>
              {positions.map((p) => {
                const pl = Number(p.unrealized_pl);
                const plpc = Number(p.unrealized_plpc) * 100;
                const col = pl > 0 ? "var(--accent)" : pl < 0 ? "var(--red)" : "var(--text2)";
                return (
                  <div key={p.symbol} className="pos-row">
                    <span className="order-sym">{p.symbol}</span>
                    <span>{p.qty}</span>
                    <span style={{ color: "var(--text2)" }}>${Number(p.avg_entry_price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    <span className="pos-pl" style={{ color: col }}>
                      {pl >= 0 ? "+" : ""}{pl.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({plpc >= 0 ? "+" : ""}{plpc.toFixed(2)}%)
                    </span>
                    <span><button className="btn danger" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setClosing(p)} type="button">Close</button></span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {allPassed && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><div className="card-title-icon">≡</div> Recent orders</div>
            <button className="btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={loadOrders} type="button">↻ Refresh</button>
          </div>
          {ordersErr ? (
            <div className="empty-state"><div>Could not load orders</div><div style={{ fontSize: 11, color: "var(--text3)" }}>{ordersErr}</div></div>
          ) : orders.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">≡</div><div>No orders yet</div></div>
          ) : (
            <div>
              <div className="order-row header">
                <span>symbol</span><span>side</span><span>qty</span><span>type</span><span>status</span>
              </div>
              {orders.map((o) => (
                <div key={o.id} className="order-row">
                  <span className="order-sym">{o.symbol}</span>
                  <span style={{ color: o.side === "buy" ? "var(--accent)" : "var(--red)" }}>{o.side}</span>
                  <span>{o.qty ?? o.filled_qty}</span>
                  <span style={{ color: "var(--text2)" }}>{o.type}</span>
                  <span className={`order-status ${statusClass(o.status)}`}>{o.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        <button className="btn" onClick={onBack}>← Back to paper trading</button>
      </div>

      {confirming && (
        <div className="modal-overlay" onClick={() => !submitting && setConfirming(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Confirm order</div>
            <div className="confirm-line"><span>Symbol</span><span>{ticket.symbol.toUpperCase()}</span></div>
            <div className="confirm-line"><span>Side</span><span style={{ color: ticket.side === "buy" ? "var(--accent)" : "var(--red)" }}>{ticket.side.toUpperCase()}</span></div>
            <div className="confirm-line"><span>Quantity</span><span>{ticket.qty}</span></div>
            <div className="confirm-line"><span>Type</span><span>{ticket.type}{ticket.type === "limit" ? ` @ ${ticket.limit_price}` : ""}</span></div>
            <div className="confirm-line"><span>Time in force</span><span>{ticket.time_in_force.toUpperCase()}</span></div>
            <div className="confirm-warn">This places a real order on your Alpaca paper account. Confirm the details above.</div>
            <div className="btn-row">
              <button className="btn" onClick={() => setConfirming(false)} disabled={submitting} type="button">Cancel</button>
              <button className="btn primary" onClick={submitOrder} disabled={submitting} type="button">
                {submitting ? "Submitting…" : "Confirm & submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {closing && (
        <div className="modal-overlay" onClick={() => !closingBusy && setClosing(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Close position</div>
            <div className="confirm-line"><span>Symbol</span><span>{closing.symbol}</span></div>
            <div className="confirm-line"><span>Quantity</span><span>{closing.qty}</span></div>
            <div className="confirm-line"><span>Market value</span><span>${Number(closing.market_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
            <div className="confirm-warn">This submits a market order to liquidate the entire position on your Alpaca paper account.</div>
            <div className="btn-row">
              <button className="btn" onClick={() => setClosing(null)} disabled={closingBusy} type="button">Cancel</button>
              <button className="btn danger" onClick={closePosition} disabled={closingBusy} type="button">
                {closingBusy ? "Closing…" : "Confirm close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
