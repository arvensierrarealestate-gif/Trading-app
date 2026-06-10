"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/errors";
import { isPaid, startCheckout, type SubscriptionInfo } from "@/lib/subscription";

// Always-visible subscription pill in the header. Pro is a button that opens
// the Stripe customer portal directly (manage card, invoices, cancel). Free is
// a clickable Upgrade pill that opens Stripe Checkout. Either way — one click,
// no need to dig into Settings.
export default function SubscriptionBadge({ subscription }: { subscription: SubscriptionInfo }) {
  const [busy, setBusy] = useState(false);
  const paid = isPaid(subscription);

  async function upgrade() {
    setBusy(true);
    try {
      await startCheckout();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not start checkout");
      setBusy(false);
    }
  }

  async function openPortal() {
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const j = await res.json();
      if (!res.ok || !j.url) {
        alert(j.error || "Could not open billing portal");
        setBusy(false);
        return;
      }
      window.location.href = j.url;
    } catch (e) {
      alert(errorMessage(e, "Network error"));
      setBusy(false);
    }
  }

  if (paid) {
    const dateStr = subscription.current_period_end
      ? new Date(subscription.current_period_end).toLocaleDateString()
      : null;
    const canceled = subscription.status === "canceled" || !!subscription.cancel_at_period_end;
    const tooltip = dateStr
      ? `${canceled ? "Access until" : "Renews"} ${dateStr} — click to manage`
      : "Pro plan — click to manage";
    return (
      <button type="button" className="sub-badge active" onClick={openPortal} disabled={busy} title={tooltip}>
        {busy ? "Opening…" : "★ Pro"}
      </button>
    );
  }

  if (subscription.status === "past_due") {
    return (
      <button type="button" className="sub-badge warn" onClick={upgrade} disabled={busy}>
        Past due — fix billing
      </button>
    );
  }

  return (
    <button type="button" className="sub-badge free" onClick={upgrade} disabled={busy} title="Upgrade to Pro">
      {busy ? "Opening…" : "Free · Upgrade →"}
    </button>
  );
}
