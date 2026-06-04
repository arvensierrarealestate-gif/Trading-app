// Subscription state + feature gates. The full app remains usable for everyone
// today — flipping a feature behind the paid tier is a one-line `isPaid` check.

export type SubscriptionStatus = "free" | "active" | "past_due" | "canceled" | "trialing";

export type SubscriptionInfo = {
  status: SubscriptionStatus | string;
  tier: string | null;
  current_period_end: string | null; // ISO timestamp
};

export function isPaid(s: SubscriptionInfo | null | undefined): boolean {
  if (!s) return false;
  if (s.status === "active" || s.status === "trialing") return true;
  // Still inside a paid period after a cancellation? Treat as paid.
  if (s.status === "canceled" && s.current_period_end) {
    return Date.parse(s.current_period_end) > Date.now();
  }
  return false;
}

// Client-only: ask the server for a Stripe Checkout URL, then redirect.
// Called from the SubscriptionBadge and every ProGate, so the upgrade path
// is the same everywhere.
export async function startCheckout(): Promise<void> {
  const res = await fetch("/api/stripe/checkout", { method: "POST" });
  const j = await res.json();
  if (res.ok && j.url) {
    window.location.href = j.url;
    return;
  }
  throw new Error(j.error || "Could not start checkout");
}
