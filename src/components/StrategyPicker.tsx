"use client";

import { useState } from "react";
import { STRATEGIES, type StrategyId } from "@/lib/strategies";

const RISK_PILL_CLASS: Record<string, string> = {
  Conservative: "risk-pill teal",
  Moderate: "risk-pill amber",
  Advanced: "risk-pill gray",
};

export default function StrategyPicker({
  initial,
  onContinue,
}: {
  initial?: StrategyId | null;
  onContinue: (id: StrategyId) => void;
}) {
  const [selected, setSelected] = useState<StrategyId | null>(initial ?? null);

  return (
    <div className="strategy-picker">
      <div className="picker-head">
        <div className="picker-title">Choose your strategy</div>
        <div className="picker-sub">
          Pick a starting strategy to pre-fill your SOP, or build your own from scratch. You can switch anytime.
        </div>
      </div>

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
        <button
          type="button"
          className="btn primary"
          disabled={!selected}
          onClick={() => selected && onContinue(selected)}
        >
          {selected ? `Continue with ${STRATEGIES.find((s) => s.id === selected)?.name}` : "Pick a strategy to continue"}
        </button>
      </div>
    </div>
  );
}
