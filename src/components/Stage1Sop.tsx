"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SOP, TradingMode } from "@/lib/types";
import { CRITICAL_FIELDS, getStrategy } from "@/lib/strategies";
import { errorMessage } from "@/lib/errors";
import TermTip from "./TermTip";
import FieldInfo from "./FieldInfo";

const LEARNER_RR = ["1:2", "1:2.5", "1:3"];

const SESSIONS = ["Asian", "London", "New York", "24/7 crypto", "Pre-market", "After hours"];
const ENTRY_SIGNALS = ["EMA crossover", "RSI oversold", "MACD cross", "Breakout", "Support bounce", "Volume spike"];
const LEARNER_SIGNALS = [
  "Price crossing moving average",
  "Price is oversold and bouncing",
  "Price breaking out of a range",
  "Price bouncing off support",
];
const ENTRY_CONFIRM = ["2+ signals align", "Higher TF agrees", "News neutral"];

const RISK_BOXES: { key: keyof SOP; label: string; term: string | null; options: string[]; safe: string }[] = [
  { key: "risk", label: "Max risk per trade", term: "position-size", options: ["0.5%", "1%", "1.5%", "2%", "3%"], safe: "1%" },
  { key: "drawdown", label: "Daily loss limit", term: "drawdown", options: ["2%", "3%", "5%"], safe: "2%" },
  { key: "rr", label: "Min R/R ratio", term: "risk-reward", options: ["1:2", "1:2.5", "1:3"], safe: "1:2" },
  { key: "max_trades", label: "Max trades per day", term: null, options: ["1", "2", "3", "5"], safe: "2" },
];

function parseList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export default function Stage1Sop({
  sop,
  mode,
  sopSaved,
  onChange,
  onSaved,
  onSwitchStrategy,
  saveLabel,
  presetJustApplied,
}: {
  sop: SOP;
  mode: TradingMode;
  sopSaved: boolean;
  onChange: (next: SOP) => void;
  onSaved: () => void;
  onSwitchStrategy?: () => void;
  saveLabel?: string;
  presetJustApplied?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const learner = mode === "learner";
  // Beginner risk limits look locked but can be unlocked per-field after a
  // disclaimer — the learner keeps the choice, with eyes open.
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const [confirmField, setConfirmField] = useState<string | null>(null);

  // Strategy template (premium-selling / leaps / momentum-swing / custom) — drives
  // the pre-fill banner, field info icons, and critical-field change warnings.
  const strategy = useMemo(() => getStrategy(sop.strategy_type ?? "custom"), [sop.strategy_type]);
  const hasTemplate = !!strategy && strategy.id !== "custom" && strategy.defaults != null;

  function reasonFor(field: keyof SOP): string | undefined {
    return strategy?.fieldReasons?.[field];
  }

  function isCriticalChange(field: keyof SOP): boolean {
    if (!hasTemplate || !strategy?.defaults) return false;
    if (!CRITICAL_FIELDS.includes(field)) return false;
    const templateVal = (strategy.defaults as Record<string, string>)[field];
    return templateVal != null && sop[field] !== templateVal;
  }

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
      setErr(errorMessage(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  function renderRiskBox(box: (typeof RISK_BOXES)[number]) {
    const isOpen = !!unlocked[box.key];
    const value = String(sop[box.key] ?? "");
    const changed = value !== box.safe;
    return (
      <div key={String(box.key)} className={`risk-box ${isOpen ? "open" : ""} ${changed ? "changed" : ""}`}>
        <div className="risk-box-head">
          <span className="risk-box-label">
            {box.term ? <TermTip term={box.term}>{box.label}</TermTip> : box.label}
            <FieldInfo text={reasonFor(box.key) ?? ""} />
          </span>
          <span className="risk-box-right">
            <span className="risk-box-value" style={changed ? { color: "var(--amber)" } : undefined}>{value}</span>
            <button
              type="button"
              className="risk-lock-btn"
              aria-label={isOpen ? "Re-lock" : "Unlock"}
              onClick={() => (isOpen ? setUnlocked((u) => ({ ...u, [box.key]: false })) : setConfirmField(String(box.key)))}
            >
              {isOpen ? "🔓" : "🔒"}
            </button>
          </span>
        </div>
        {isOpen ? (
          <>
            <select value={value} onChange={(e) => onChange({ ...sop, [box.key]: e.target.value })}>
              {box.options.map((o) => <option key={o}>{o}</option>)}
            </select>
            {changed && <div className="warn-msg">⚠ Above the beginner-safe default ({box.safe}). Higher risk — be sure this is intentional.</div>}
          </>
        ) : (
          <div className="risk-box-note">This limit protects your account while you are learning.</div>
        )}
      </div>
    );
  }

  const signalChoices = learner ? LEARNER_SIGNALS : ENTRY_SIGNALS;

  return (
    <div className="sop-wrap">
      {learner && (
        <div className="protect-banner">
          <span className="protect-shield" aria-hidden>🛡</span>
          Your account is protected · Max {sop.risk} risk per trade · Max {sop.drawdown} daily loss
        </div>
      )}

      {hasTemplate && strategy && (
        <div className="strategy-banner">
          <div className="strategy-banner-text">
            {presetJustApplied ? (
              <>
                This SOP was pre-filled using the <strong>{strategy.name}</strong> preset strategy.
                All values are fully editable — adjust anything to match your personal style before saving.
              </>
            ) : (
              <>
                Your SOP has been pre-filled with the <strong>{strategy.name}</strong> strategy settings.
                Review each section and save when ready.
              </>
            )}
          </div>
          {onSwitchStrategy && (
            <button type="button" className="strategy-switch-link" onClick={onSwitchStrategy}>
              Switch strategy →
            </button>
          )}
        </div>
      )}

      <div className="sop-grid">
        {/* LEFT — Market scope */}
        <div className="card">
          <div className="card-header">
            <div className="card-title"><div className="card-title-icon">◰</div> Market scope</div>
          </div>
          <div className="section-block">
            <div className="field">
              <label>Assets / pairs</label>
              <input type="text" value={sop.assets} onChange={(e) => onChange({ ...sop, assets: e.target.value })} placeholder="BTC/USD, AAPL…" />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Primary timeframe</label>
              <select value={sop.tf} onChange={(e) => onChange({ ...sop, tf: e.target.value })}>
                {["15m", "1h", "4h", "1d", "1w"].map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Sessions</label>
              <div className="tag-row">
                {SESSIONS.map((s) => (
                  <span key={s} className={`tag ${sessionsSel.includes(s) ? "sel" : ""}`} onClick={() => toggleIn("sessions", s)}>{s}</span>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Entry signals{learner ? " (plain English)" : ""}</label>
              <div className="tag-row">
                {signalChoices.map((s) => (
                  <span key={s} className={`tag ${signalsSel.includes(s) ? "sel" : ""}`} onClick={() => toggleIn("entry_signals", s)}>{s}</span>
                ))}
              </div>
            </div>
            {!learner && (
              <div className="field" style={{ marginTop: 14 }}>
                <label>Confirmation required</label>
                <div className="tag-row">
                  {ENTRY_CONFIRM.map((s) => (
                    <span key={s} className={`tag ${confirmSel.includes(s) ? "sel" : ""}`} onClick={() => toggleIn("entry_confirm", s)}>{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Risk management */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <div className="card-title-icon">🛡</div> Risk management {learner && <span className="locked-tag">· protected</span>}
            </div>
          </div>
          <div className="section-block">
            {learner ? (
              <div className="risk-box-list">{RISK_BOXES.map(renderRiskBox)}</div>
            ) : (
              <div className="form-grid">
                <div className="field">
                  <label><TermTip term="position-size">Max risk per trade</TermTip> <FieldInfo text={reasonFor("risk") ?? ""} /></label>
                  <select value={sop.risk} onChange={(e) => onChange({ ...sop, risk: e.target.value })}>
                    {["0.5%", "1%", "1.5%", "2%", "3%", "5%"].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label><TermTip term="drawdown">Daily loss limit</TermTip> <FieldInfo text={reasonFor("drawdown") ?? ""} /></label>
                  <select value={sop.drawdown} onChange={(e) => onChange({ ...sop, drawdown: e.target.value })}>
                    {["2%", "3%", "5%", "10%"].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Min <TermTip term="risk-reward">R/R ratio</TermTip> <FieldInfo text={reasonFor("rr") ?? ""} /></label>
                  <select value={sop.rr} onChange={(e) => onChange({ ...sop, rr: e.target.value })}>
                    {["1:1.5", "1:2", "1:2.5", "1:3"].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Max trades per day <FieldInfo text={reasonFor("max_trades") ?? ""} /></label>
                  <select value={sop.max_trades} onChange={(e) => onChange({ ...sop, max_trades: e.target.value })}>
                    {["1", "2", "3", "5", "No limit"].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="field" style={{ marginTop: 16 }}>
              <label><TermTip term="stop-loss">Stop loss method</TermTip> <FieldInfo text={reasonFor("sl") ?? ""} /></label>
              <input type="text" value={sop.sl} onChange={(e) => onChange({ ...sop, sl: e.target.value })} placeholder="Below recent swing low…" />
              <div className="risk-box-note">A stop loss automatically exits your trade if price moves against you by this amount. Always required.</div>
              {isCriticalChange("sl") && <div className="warn-msg">⚠ Changing this setting increases your risk. Are you sure?</div>}
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Take profit method <FieldInfo text={reasonFor("tp") ?? ""} /></label>
              <input type="text" value={sop.tp} onChange={(e) => onChange({ ...sop, tp: e.target.value })} placeholder="Fixed R/R, key resistance…" />
              {isCriticalChange("tp") && <div className="warn-msg">⚠ Changing this setting increases your risk. Are you sure?</div>}
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Entry notes</label>
              <textarea value={sop.entry_notes} onChange={(e) => onChange({ ...sop, entry_notes: e.target.value })} placeholder="Only trade during session opens. Wait for confirmation before entry. No revenge trades." />
            </div>

            <div className="btn-row">
              <span className="btn-hint">Saving locks the SOP and unlocks paper trading.</span>
              {err && <span className="btn-hint" style={{ color: "var(--red)", flex: "initial" }}>{err}</span>}
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : (saveLabel ?? "Save SOP")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">≋</div> Market regime filter</div>
        </div>
        <div className="section-block">
          <div className="field">
            <label>Only trade in these SPY regimes <FieldInfo text={reasonFor("regimes") ?? ""} /></label>
            <div className="tag-row">
              {[
                { key: "crash", label: "Crash" },
                { key: "bear", label: "Bear" },
                { key: "neutral", label: "Neutral" },
                { key: "bull", label: "Bull" },
              ].map((r) => (
                <span key={r.key} className={`tag ${regimesSel.includes(r.key) ? "sel" : ""}`} onClick={() => toggleIn("regimes", r.key)}>{r.label}</span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
              The Regime tab estimates the live SPY regime with an HMM. Trades graded while the market is outside these regimes are flagged as out-of-SOP.
            </div>
            {isCriticalChange("regimes") && <div className="warn-msg">⚠ Changing this setting increases your risk. Are you sure?</div>}
          </div>
        </div>
      </div>

      {confirmField && (
        <div className="modal-overlay" onClick={() => setConfirmField(null)}>
          <div className="confirm-card warn" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Unlock this safety limit?</div>
            <div className="confirm-body">
              These limits are set to protect your account while you build the habit. Unlocking lets you raise your
              risk above the beginner-safe default. Only do this if you understand the added risk.
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setConfirmField(null)}>Cancel — keep me protected</button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  setUnlocked((u) => ({ ...u, [confirmField]: true }));
                  setConfirmField(null);
                }}
              >
                Unlock and edit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
