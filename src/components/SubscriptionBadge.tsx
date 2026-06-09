"use client";

import { useState } from "react";
import { isPaid, startCheckout, type SubscriptionInfo } from "@/lib/subscription";

// Always-visible subscription pill in the header. Pro shows as a green badge
// (with the renewal date on hover). Free shows as a clickable Upgrade pill
// that opens Stripe Checkout directly — no need to dig into Settings.
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

  if (paid) {
    const dateStr = subscription.current_period_end
      ? new Date(subscription.current_period_end).toLocaleDateString()
      : null;
    const canceled = subscription.status === "canceled";
    const tooltip = dateStr
      ? `${canceled ? "Access until" : "Renews"} ${dateStr}`
      : "Pro plan";
    return (
      <span className="sub-badge active" title={tooltip}>
        ★ Pro
      </span>
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
