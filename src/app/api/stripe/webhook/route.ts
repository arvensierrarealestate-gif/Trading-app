import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, mapStatus } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Newer Stripe API versions (2025-04-30.basil and later, including the
// 2026-05-27.dahlia destination created in Workbench) moved
// `current_period_end` off the top-level Subscription onto its items array.
// This helper handles both shapes — read items first, fall back to the legacy
// top-level field — so this code survives across API versions.
function extractPeriodEnd(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  if (item?.current_period_end) return item.current_period_end;
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  return legacy ?? null;
}

function toIso(unixSeconds: number | null): string | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

// Stripe signs the raw bytes of the request body. Don't reach for req.json()
// here — we need the exact text, signature header, and webhook secret.
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    return NextResponse.json({ error: `Signature verification failed: ${e instanceof Error ? e.message : "unknown"}` }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = (session.client_reference_id ?? session.metadata?.user_id) as string | undefined;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (!userId || !customerId || !subscriptionId) {
          console.log("[stripe webhook] checkout.session.completed — missing ids", { userId, customerId, subscriptionId });
          break;
        }

        const stripe = getStripe();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const periodEnd = extractPeriodEnd(sub);
        const { error } = await admin.from("profiles").upsert({
          id: userId,
          stripe_customer_id: customerId,
          subscription_status: mapStatus(sub.status),
          subscription_tier: "pro",
          subscription_current_period_end: toIso(periodEnd),
          subscription_cancel_at_period_end: !!sub.cancel_at_period_end,
        });
        if (error) throw new Error(`profiles upsert: ${error.message}`);
        console.log("[stripe webhook] checkout completed → pro", { userId, status: sub.status });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const periodEnd = extractPeriodEnd(sub);
        const paid = sub.status === "active" || sub.status === "trialing";
        const { error } = await admin
          .from("profiles")
          .update({
            subscription_status: mapStatus(sub.status),
            subscription_tier: paid ? "pro" : null,
            subscription_current_period_end: toIso(periodEnd),
            subscription_cancel_at_period_end: !!sub.cancel_at_period_end,
          })
          .eq("stripe_customer_id", customerId);
        if (error) throw new Error(`profiles update: ${error.message}`);
        console.log("[stripe webhook] subscription", event.type, "→", sub.status, { customerId });
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const { error } = await admin
          .from("profiles")
          .update({ subscription_status: "canceled", subscription_tier: null, subscription_cancel_at_period_end: false })
          .eq("stripe_customer_id", customerId);
        if (error) throw new Error(`profiles update: ${error.message}`);
        console.log("[stripe webhook] subscription canceled", { customerId });
        break;
      }
      default:
        // No-op for unhandled events — return 200 so Stripe doesn't retry.
        break;
    }
  } catch (e) {
    // Surface the error to Stripe so it retries and shows up in the Workbench
    // delivery log instead of silently succeeding while the DB didn't update.
    const msg = e instanceof Error ? e.message : "handler failed";
    console.error("[stripe webhook]", event.type, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
