"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/errors";
import { isPaid, type SubscriptionInfo } from "@/lib/subscription";

export default function SubscriptionPanel({ subscription }: { subscription: SubscriptionInfo }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go(path: "checkout" | "portal") {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/stripe/${path}`, { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.url) {
        setErr(j.error || "Could not start billing flow");
        setBusy(false);
        return;
      }
      window.location.href = j.url;
    } catch (e) {
      setErr(errorMessage(e, "Network error"));
      setBusy(false);
    }
  }

  const paid = isPaid(subscription);
  const cancelPending = subscription.status === "canceled" || !!subscription.cancel_at_period_end;
  const statusLabel = paid
    ? cancelPending ? "Pro · canceling" : "Pro · active"
    : subscription.status === "canceled" ? "Canceled" : "Free";
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="dash-card">
      <div className="card-header">
        <div className="card-title"><div className="card-title-icon">💳</div> Subscription</div>
        <span className={`sub-status ${paid ? "active" : "free"}`}>{statusLabel}</span>
      </div>
      <div className="section-block">
        {paid ? (
          <>
            <div className="kv"><span>Plan</span><strong>Pro</strong></div>
            {periodEnd && <div className="kv"><span>{cancelPending ? "Access until" : "Renews"}</span><strong>{periodEnd}</strong></div>}
            <div className="btn-row" style={{ marginTop: 12 }}>
              <span className="btn-hint">Update card, see invoices, or cancel in the Stripe customer portal.</span>
              <button className="btn" onClick={() => go("portal")} disabled={busy} type="button">
                {busy ? "Opening…" : "Manage subscription"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="sub-pitch">
              You're on the <strong>Free</strong> plan. Upgrade to <strong>Pro</strong> to unlock trader-mode features
              (scalp monitor, recommendations rail, ticker detail panel) and everything we add next.
            </div>
            <div className="btn-row" style={{ marginTop: 14 }}>
              <span className="btn-hint">Secure checkout via Stripe. Cancel anytime.</span>
              <button className="btn primary" onClick={() => go("checkout")} disabled={busy} type="button">
                {busy ? "Opening…" : "Upgrade to Pro →"}
              </button>
            </div>
          </>
        )}
        {err && <div className="auth-msg err" style={{ marginTop: 10 }}>{err}</div>}
      </div>
    </div>
  );
}
