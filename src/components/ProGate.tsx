"use client";

import { useState } from "react";
import { startCheckout } from "@/lib/subscription";

// Friendly upgrade prompt shown wherever a Free user hits a Pro-only feature.
// Copy stays encouraging — the user earned their way here, the upgrade is
// the next step, not a wall.
export default function ProGate({
  title = "This is a live trading tool",
  description,
  onBack,
  backLabel = "Back to practice",
}: {
  title?: string;
  description: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upgrade() {
    setBusy(true);
    setErr(null);
    try {
      await startCheckout();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start upgrade");
      setBusy(false);
    }
  }

  return (
    <div className="pro-gate-card">
      <div className="pro-gate-lock" aria-hidden>🔒</div>
      <div className="pro-gate-title">{title}</div>
      <div className="pro-gate-sub">
        You have reached this because you completed your go-live checklist.
        These tools are for active traders placing real money trades.
      </div>
      <div className="pro-gate-desc">{description}</div>
      <div className="pro-gate-actions">
        <button type="button" className="btn primary pro-gate-cta" onClick={upgrade} disabled={busy}>
          {busy ? "Opening Stripe…" : "Upgrade to Pro · $19/mo"}
        </button>
        {onBack && (
          <button type="button" className="btn" onClick={onBack} disabled={busy}>
            {backLabel}
          </button>
        )}
      </div>
      {err && <div className="auth-msg err" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}
