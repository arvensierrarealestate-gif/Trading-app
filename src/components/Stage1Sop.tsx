"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SOP, TradingMode } from "@/lib/types";
import TermTip from "./TermTip";

const LOCK_MSG = "This limit protects your account while you are learning. You can adjust this when you graduate to trader mode.";
const LEARNER_RR = ["1:2", "1:2.5", "1:3"];

const SESSIONS = ["Asian", "London", "New York", "24/7 crypto", "Pre-market", "After hours"];
const ENTRY_SIGNALS = ["EMA crossover", "RSI oversold", "MACD cross", "Breakout", "Support bounce", "Volume spike"];
const ENTRY_CONFIRM = ["2+ signals align", "Higher TF agrees", "News neutral"];

function parseList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function Stage1Sop({
  sop,
  mode,
  sopSaved,
  onChange,
  onSaved,
}: {
  sop: SOP;
  mode: TradingMode;
  sopSaved: boolean;
  onChange: (next: SOP) => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const learner = mode === "learner";
  // In learner mode: open while you're picking your first SOP, locked once saved.
  const riskLocked = learner && sopSaved;

  // Learner ceilings: pick within safe limits, then lock after first save.
  // Values from trader mode that exceed learner ceilings are clamped on entry.
  useEffect(() => {
    if (!learner) return;
    const fixed: Partial<SOP> = {};
    const r = parseFloat(sop.risk);
    if (!Number.isFinite(r) || r > 3) fixed.risk = "3%";
    const d = parseFloat(sop.drawdown);
    if (!Number.isFinite(d) || d > 5) fixed.drawdown = "5%";
    if (!["1", "2", "3", "5"].includes(sop.max_trades)) fixed.max_trades = "5";
    if (!LEARNER_RR.includes(sop.rr)) fixed.rr = "1:2";
    if (Object.keys(fixed).length) onChange({ ...sop, ...fixed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learner, sop.risk, sop.drawdown, sop.max_trades, sop.rr]);

  const sessionsSel = parseList(sop.sessions);
  const signalsSel = parseList(sop.entry_signals);
  const confirmSel = parseList(sop.entry_confirm);
  const regimesSel = parseList(sop.regimes);

  function toggleIn(field: "sessions" | "entry_signals" | "entry_confirm" | "regimes", value: string) {
    const cur = parseList(sop[field]);
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    onChange({ ...sop, [field]: next.join(", ") });
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("sops").upsert({ user_id: user.id, ...sop, updated_at: new Date().toISOString() });
      if (error) throw error;
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message
        : typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message)
        : "Save failed";
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">
          <div className="card-title-icon">⚙</div>
          Your standard operating procedure
        </div>
        <div className="card-meta">saved to Supabase · used for AI grading</div>
      </div>

      <div className="section-block">
        <div className="section-label">Assets &amp; session</div>
        <div className="form-grid">
          <div className="field">
            <label>Trading pairs / assets</label>
            <input
              type="text"
              value={sop.assets}
              onChange={(e) => onChange({ ...sop, assets: e.target.value })}
              placeholder="BTC/USD, ETH/USD, AAPL…"
            />
          </div>
          <div className="field">
            <label>Primary timeframe</label>
            <select value={sop.tf} onChange={(e) => onChange({ ...sop, tf: e.target.value })}>
              {["15m", "1h", "4h", "1d", "1w"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Trading sessions</label>
          <div className="tag-row">
            {SESSIONS.map((s) => (
              <span
                key={s}
                className={`tag ${sessionsSel.includes(s) ? "sel" : ""}`}
                onClick={() => toggleIn("sessions", s)}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="section-block">
        <div className="section-label">Entry rules</div>
        <div className="form-grid">
          <div className="field">
            <label>Entry signals</label>
            <div className="tag-row">
              {ENTRY_SIGNALS.map((s) => (
                <span
                  key={s}
                  className={`tag ${signalsSel.includes(s) ? "sel" : ""}`}
                  onClick={() => toggleIn("entry_signals", s)}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
          {!learner && (
            <div className="field">
              <label>Confirmation required</label>
              <div className="tag-row">
                {ENTRY_CONFIRM.map((s) => (
                  <span
                    key={s}
                    className={`tag ${confirmSel.includes(s) ? "sel" : ""}`}
                    onClick={() => toggleIn("entry_confirm", s)}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {!learner && (
          <div className="form-grid single">
            <div className="field">
              <label>Entry rule in your own words</label>
              <textarea
                value={sop.entry_notes}
                onChange={(e) => onChange({ ...sop, entry_notes: e.target.value })}
                placeholder="e.g. Only enter when price is above EMA50 and RSI is between 40–65 on the 4h chart…"
              />
            </div>
          </div>
        )}
      </div>

      <div className="section-block">
        <div className="section-label">Exit rules</div>
        <div className="form-grid three">
          <div className="field">
            <label>Take profit method</label>
            <select value={sop.tp} onChange={(e) => onChange({ ...sop, tp: e.target.value })}>
              {["Fixed R/R ratio", "Key resistance", "Trailing stop", "Time-based"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Stop loss method</label>
            <select value={sop.sl} onChange={(e) => onChange({ ...sop, sl: e.target.value })}>
              {["ATR-based", "Below support", "Fixed %", "Swing low/high"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Minimum <TermTip term="risk-reward">R/R ratio</TermTip></label>
            <select value={sop.rr} onChange={(e) => onChange({ ...sop, rr: e.target.value })}>
              {(learner ? LEARNER_RR : ["1:1.5", "1:2", "1:2.5", "1:3"]).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            {learner && <div className="lock-msg">🔒 Minimum 1:2. {LOCK_MSG}</div>}
          </div>
        </div>
      </div>

      <div className="section-block">
        <div className="section-label">Risk management</div>
        <div className="form-grid three">
          <div className="field">
            <label><TermTip term="position-size">Max risk per trade</TermTip></label>
            <select value={sop.risk} disabled={riskLocked} onChange={(e) => onChange({ ...sop, risk: e.target.value })}>
              {["0.5%", "1%", "1.5%", "2%", "3%"].map((v) => <option key={v}>{v}</option>)}
            </select>
            {riskLocked
              ? <div className="lock-msg">🔒 Locked at {sop.risk}. You chose this when you saved your SOP. To change it, switch to trader mode.</div>
              : learner ? <div className="hint-msg">Pick up to 3%. Locks once you save your SOP.</div> : null}
          </div>
          <div className="field">
            <label>Max trades per day</label>
            <select value={sop.max_trades} disabled={riskLocked} onChange={(e) => onChange({ ...sop, max_trades: e.target.value })}>
              {(learner ? ["1", "2", "3", "5"] : ["1", "2", "3", "5", "No limit"]).map((v) => <option key={v}>{v}</option>)}
            </select>
            {riskLocked
              ? <div className="lock-msg">🔒 Locked at {sop.max_trades}. You chose this when you saved your SOP. To change it, switch to trader mode.</div>
              : learner ? <div className="hint-msg">Up to 5 trades per day. Locks once you save.</div> : null}
          </div>
          <div className="field">
            <label><TermTip term="drawdown">Daily loss limit</TermTip></label>
            <select value={sop.drawdown} disabled={riskLocked} onChange={(e) => onChange({ ...sop, drawdown: e.target.value })}>
              {["2%", "3%", "5%"].map((v) => <option key={v}>{v}</option>)}
            </select>
            {riskLocked
              ? <div className="lock-msg">🔒 Locked at {sop.drawdown}. You chose this when you saved your SOP. To change it, switch to trader mode.</div>
              : learner ? <div className="hint-msg">Pick up to 5%. Locks once you save.</div> : null}
          </div>
        </div>
      </div>

      {!learner && (
      <div className="section-block">
        <div className="section-label">Market regime filter</div>
        <div className="field">
          <label>Only trade in these SPY regimes</label>
          <div className="tag-row">
            {[
              { key: "crash", label: "Crash" },
              { key: "bear", label: "Bear" },
              { key: "neutral", label: "Neutral" },
              { key: "bull", label: "Bull" },
            ].map((r) => (
              <span
                key={r.key}
                className={`tag ${regimesSel.includes(r.key) ? "sel" : ""}`}
                onClick={() => toggleIn("regimes", r.key)}
              >
                {r.label}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
            The Regime tab estimates the live SPY regime with an HMM. Trades graded while the market is
            outside these regimes are flagged as out-of-SOP.
          </div>
        </div>
      </div>
      )}

      <div className="btn-row">
        <span className="btn-hint">Your SOP will be used by AI to grade every paper trade</span>
        {err && <span className="btn-hint" style={{ color: "var(--red)", flex: "initial" }}>{err}</span>}
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save SOP & unlock stage 2 →"}
        </button>
      </div>
    </div>
  );
}
