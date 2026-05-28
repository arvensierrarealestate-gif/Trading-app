"use client";

import { useState } from "react";
import { STRATEGIES, getStrategy, type StrategyId } from "@/lib/strategies";

const RISK_PILL_CLASS: Record<string, string> = {
  Conservative: "risk-pill teal",
  Moderate: "risk-pill amber",
  Advanced: "risk-pill gray",
};

export default function StrategyPicker({
  initial,
  onContinue,
  onCancel,
  hasSavedSop = false,
}: {
  initial?: StrategyId | null;
  onContinue: (id: StrategyId) => void;
  onCancel?: () => void;
  hasSavedSop?: boolean;
}) {
  const [selected, setSelected] = useState<StrategyId | null>(initial ?? null);
  const [confirming, setConfirming] = useState<StrategyId | null>(null);

  // Replacing an existing SOP with a real preset needs a confirm step. Picking
  // "Build my own" or applying with no saved SOP applies immediately.
  function attempt(id: StrategyId) {
    const isPreset = !!getStrategy(id)?.defaults; // custom has no defaults
    if (hasSavedSop && isPreset) setConfirming(id);
    else onContinue(id);
  }

  const confirmName = confirming ? getStrategy(confirming)?.name : null;

  return (
    <div className="strategy-picker">
      <div className="picker-head">
        <div className="picker-title">Choose your strategy</div>
        <div className="picker-sub">
          Pick a starting strategy to pre-fill your SOP, or build your own from scratch. You can switch anytime.
        </div>
      </div>

      {hasSavedSop && (
        <div className="picker-disclaimer">
          ⚠ You already have a saved SOP. Choosing a preset strategy below will replace your current settings.
          You can always come back and customize any preset after applying it.
        </div>
      )}

      <div className="strategy-grid">
        {STRATEGIES.map((s) => {
          const active = selected === s.id;
          return (
            <button
              key={s.id}
              type="button"
              className={`strategy-card accent-${s.accent} ${active ? "selected" : ""}`}
              onClick={() => setSelected(s.id)}
            >
              <div className="strategy-card-head">
                <div>
                  <div className="strategy-card-name">{s.name}</div>
                  <div className="strategy-card-sub">{s.subtitle}</div>
                </div>
                {active && <span className="strategy-check" aria-hidden>✓</span>}
              </div>
              <div className="strategy-card-meta">
                <span className={RISK_PILL_CLASS[s.risk] ?? "risk-pill gray"}>{s.risk}</span>
                {s.accountRange && <span className="account-range">Account size: {s.accountRange}</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="picker-foot">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={!selected}
          onClick={() => selected && attempt(selected)}
        >
          {selected ? `Continue with ${STRATEGIES.find((s) => s.id === selected)?.name}` : "Pick a strategy to continue"}
        </button>
      </div>

      {confirming && confirmName && (
        <div className="modal-overlay" onClick={() => setConfirming(null)}>
          <div className="confirm-card warn" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Replace your current SOP?</div>
            <div className="confirm-body">
              This will replace your current SOP with the <strong>{confirmName}</strong> preset.
              Your previous settings will be lost. Continue?
            </div>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const id = confirming;
                  setConfirming(null);
                  onContinue(id);
                }}
              >
                Yes, replace my SOP
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
