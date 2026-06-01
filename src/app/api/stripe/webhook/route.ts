import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, mapStatus } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

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
        if (!userId || !customerId || !subscriptionId) break;

        const stripe = getStripe();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const periodEnd = (sub as unknown as { current_period_end: number }).current_period_end;
        await admin.from("profiles").upsert({
          id: userId,
          stripe_customer_id: customerId,
          subscription_status: mapStatus(sub.status),
          subscription_tier: "pro",
          subscription_current_period_end: new Date(periodEnd * 1000).toISOString(),
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const periodEnd = (sub as unknown as { current_period_end: number }).current_period_end;
        await admin
          .from("profiles")
          .update({
            subscription_status: mapStatus(sub.status),
            subscription_tier: sub.status === "active" || sub.status === "trialing" ? "pro" : null,
            subscription_current_period_end: new Date(periodEnd * 1000).toISOString(),
          })
          .eq("stripe_customer_id", customerId);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        await admin
          .from("profiles")
          .update({ subscription_status: "canceled", subscription_tier: null })
          .eq("stripe_customer_id", customerId);
        break;
      }
      default:
        // No-op for unhandled events — return 200 so Stripe doesn't retry.
        break;
    }
  } catch (e) {
    // Log and acknowledge — better to ack than to have Stripe retry storms.
    console.error("[stripe webhook]", event.type, e);
  }

  return NextResponse.json({ received: true });
}
