"use client";

import { getStrategy } from "@/lib/strategies";
import type { SOP } from "@/lib/types";

export default function SopReviewGate({
  sop,
  updatedAt,
  onContinue,
  onReview,
  onSwitchPreset,
}: {
  sop: SOP;
  updatedAt: string | null;
  onContinue: () => void;
  onReview: () => void;
  onSwitchPreset: () => void;
}) {
  const strategy = getStrategy(sop.strategy_type ?? "custom");
  const label = strategy?.name ?? "Custom";
  const updated = updatedAt
    ? new Date(updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";

  return (
    <div className="card sop-review-card">
      <div className="section-block">
        <div className="sop-review-title">You already have a trading SOP saved.</div>
        <div className="sop-review-meta">
          <div>Your current strategy: <strong>{label}</strong></div>
          <div>Last updated: <strong>{updated}</strong></div>
        </div>
        <div className="sop-review-q">What would you like to do?</div>

        <div className="sop-review-actions">
          <button type="button" className="btn outline-teal" onClick={onContinue}>
            Continue with my current SOP
          </button>
          <button type="button" className="btn primary" onClick={onReview}>
            Review and customize my SOP
          </button>
          <button type="button" className="btn outline-gray" onClick={onSwitchPreset}>
            Switch to a preset strategy
          </button>
        </div>
      </div>
    </div>
  );
}
