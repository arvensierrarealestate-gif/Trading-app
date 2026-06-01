import Stripe from "stripe";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  cached = new Stripe(key);
  return cached;
}

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";

// Map a Stripe subscription status to the simplified status we store. An
// active or trialing subscription unlocks the paid tier; anything else falls
// back to free at the next period end.
export function mapStatus(s: Stripe.Subscription.Status): string {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return s;
}
