"use client";

import { useState } from "react";
import { startCheckout } from "@/lib/subscription";

// Conversion moment: the learner just completed all 9 go-live discipline
// checks. We celebrate the achievement and surface the upgrade as the
// natural next step.
export default function GoLiveCongrats({ avgScore }: { avgScore: number }) {
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
    <div className="congrats-card">
      <div className="congrats-icon" aria-hidden>🎯</div>
      <div className="congrats-title">You are ready to trade live</div>
      <div className="congrats-body">You completed all 9 discipline checks.</div>
      <div className="congrats-body">
        Your paper trading average score was <strong>{avgScore}</strong>.
      </div>
      <div className="congrats-next">
        The next step is upgrading to Pro to access the live trading tools.
      </div>
      <button type="button" className="btn primary congrats-cta" onClick={upgrade} disabled={busy}>
        {busy ? "Opening Stripe…" : "Upgrade to Pro · $19/mo →"}
      </button>
      <div className="congrats-hint">
        Cancel anytime · Live trading uses your own brokerage account
      </div>
      {err && <div className="auth-msg err" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}
