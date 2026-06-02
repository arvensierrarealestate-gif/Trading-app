"use client";

import { useState } from "react";
import { isPaid, type SubscriptionInfo } from "@/lib/subscription";

// Always-visible subscription pill in the header. Pro shows as a green badge
// (with the renewal date on hover). Free shows as a clickable Upgrade pill
// that opens Stripe Checkout directly — no need to dig into Settings.
export default function SubscriptionBadge({ subscription }: { subscription: SubscriptionInfo }) {
  const [busy, setBusy] = useState(false);
  const paid = isPaid(subscription);

  async function upgrade() {
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const j = await res.json();
      if (j.url) {
        window.location.href = j.url;
      } else {
        alert(j.error || "Could not start checkout");
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }

  if (paid) {
    const renews = subscription.current_period_end
      ? `Renews ${new Date(subscription.current_period_end).toLocaleDateString()}`
      : "Pro plan";
    return (
      <span className="sub-badge active" title={renews}>
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
