# Billing setup (Stripe)

Run through these steps once to enable paid subscriptions. Do everything in
**Stripe test mode** first; switch keys to live mode only after you've
completed an end-to-end test checkout.

---

## 1. Run migration `0012`

Supabase SQL Editor → New query → paste from `supabase/migrations/0012_subscriptions.sql` → Run.

Expected: `Success. No rows returned.`

## 2. Create a Stripe product + price

https://dashboard.stripe.com (test mode, top-left toggle) → **Products** → **Add product**.

- Name: `TradeReady Pro`
- Pricing: **Recurring**, pick monthly + your price (e.g. $19/month). You can add an annual price later.
- Save.
- On the product page, copy the **Price ID** (`price_…`) — you'll need it.

## 3. Get your API keys

https://dashboard.stripe.com/test/apikeys

- **Publishable key** (`pk_test_…`) → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- **Secret key** (`sk_test_…`) → `STRIPE_SECRET_KEY`

## 4. Set up the webhook endpoint

https://dashboard.stripe.com/test/webhooks → **Add endpoint**.

- Endpoint URL: `https://trading-app-alpha-henna.vercel.app/api/stripe/webhook`
- Events to listen for: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- Save. On the endpoint page click **Reveal signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.

## 5. Configure the customer portal (one-time)

https://dashboard.stripe.com/test/settings/billing/portal → **Activate test link**.

This lets users manage their own subscription (update card, cancel) from inside the app.

## 6. Add env vars in Vercel

Vercel → `trading-app` → Settings → Environment Variables → Production:

```
STRIPE_SECRET_KEY              sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  pk_test_...
STRIPE_PRICE_ID                price_...
STRIPE_WEBHOOK_SECRET          whsec_...
NEXT_PUBLIC_APP_URL            https://trading-app-alpha-henna.vercel.app
```

Then **Deployments → ⋯ → Redeploy** (uncheck "Use existing Build Cache").

## 7. Smoke test

1. Open the app → Settings → Subscription panel should show **Free**.
2. Click **Upgrade to Pro →** → Stripe Checkout opens.
3. Use Stripe's test card: `4242 4242 4242 4242`, any future date, any CVC, any zip.
4. Complete payment → you're redirected to `/app?subscribed=1`.
5. Within ~10 seconds (after the webhook fires), reload Settings → status should flip to **Pro · active** with a renewal date.
6. Click **Manage subscription** → Stripe customer portal opens, where you can cancel for testing.

If the status doesn't flip:
- Stripe dashboard → Webhooks → your endpoint → **Logs**: check the event was delivered with a 200 response.
- If you see a 4xx, check the webhook secret in Vercel env vars matches.

## 8. Going live

When you're ready to take real money:
- Toggle Stripe to live mode (top-left).
- Repeat steps 2-6 with **live keys** (`sk_live_…`, `pk_live_…`, etc.).
- Verify your account is fully activated in Stripe (business details, tax, payouts).

---

## Legal pages

The app ships with **draft** legal pages at `/legal/risk`, `/legal/terms`, `/legal/privacy`. They cover
the essentials for a trading-discipline SaaS but **must be reviewed by a lawyer** before launch. The
risk disclaimer is non-negotiable for any trading-adjacent product.

## What's behind the paywall today

By default, the app is fully usable on **Free**. Feature gating is wired but not enforced yet — use the
`isPaid()` helper in `src/lib/subscription.ts` to gate whatever you decide should be Pro-only:

```tsx
import { isPaid } from "@/lib/subscription";
if (!isPaid(subscription)) return <UpgradeNudge />;
```

Common gating choices:
- Trader mode entirely (Pro-only).
- Scalp monitor (Pro-only).
- Recommendations rail (Pro-only).
- Ticker detail panel (Pro-only).

Add the gate, then everyone on Free sees an "Upgrade to Pro" nudge instead.
