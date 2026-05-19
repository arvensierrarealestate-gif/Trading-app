# TradeReady

A three-stage trader onboarding app: build your SOP, paper trade with AI grading, then go live through Alpaca.

- **Stage 1 — SOP builder**: define entry/exit rules, risk caps, sessions.
- **Stage 2 — Paper trade grader**: upload a chart screenshot, AI grades against your SOP using a 6-gate filter (trend, momentum, volume, MACD context, R/R, volatility).
- **Stage 3 — Go-live checklist**: 8 items (2 auto, 6 manual), Alpaca paper account status, unlock once all pass.

Stack: Next.js 15 (App Router) · TypeScript · Tailwind v4 · Supabase auth + Postgres · Anthropic SDK (server-side) · Alpaca paper trading API.

## Setup

### 1. Supabase project

1. Create a project at <https://supabase.com>.
2. Open the SQL editor and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql). It creates `profiles`, `sops`, `paper_trades`, `go_live_checks`, RLS policies, and a trigger that creates a profile row on sign-up.
3. In **Auth → URL configuration**, add your dev and prod URLs to the allowed redirect list:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR_VERCEL_DOMAIN/auth/callback`

### 2. Environment

Copy `.env.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
ANTHROPIC_API_KEY=...
ALPACA_KEY_ID=...
ALPACA_SECRET_KEY=...
ALPACA_BASE_URL=https://paper-api.alpaca.markets/v2
```

### 3. Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to `/login` for a magic-link sign-in.

## Deploy to Vercel

1. Push this repo to GitHub (already configured on this branch).
2. Import the repo on Vercel.
3. Set the same env vars from `.env.example` in **Project settings → Environment variables**.
4. Update the Supabase **Auth → URL configuration** with your Vercel URL once you have it.

## Routes

| Route                       | Purpose                                |
| --------------------------- | -------------------------------------- |
| `/`                         | Redirects to `/app` or `/login`        |
| `/login`                    | Email magic-link sign-in               |
| `/auth/callback`            | Supabase OAuth code exchange           |
| `/app`                      | Protected 3-stage onboarding shell     |
| `/api/grade`                | POST chart + SOP → Anthropic grade     |
| `/api/alpaca/account`       | GET Alpaca paper account summary       |

## Security notes

- The Anthropic API key only lives server-side. The browser posts to `/api/grade`, which proxies to Anthropic with the user's session cookie validated.
- Alpaca keys are server-side only. Never expose them with `NEXT_PUBLIC_`.
- Row Level Security is enforced on every user table: a row is only readable/writable by the user that owns it.
