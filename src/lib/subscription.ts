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
