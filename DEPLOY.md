# Deploying TradeReady to Vercel

The app is a standard Next.js 16 App Router project — Vercel auto-detects it, no
custom build settings needed. Same Supabase project and migrations as local; only
the environment variables and auth redirect URLs differ.

## 1. Prerequisites (do these once, locally)

- Run both SQL migrations in your Supabase SQL editor, in order:
  1. `supabase/migrations/0001_init.sql`
  2. `supabase/migrations/0002_api_usage.sql`
- Confirm `npm run dev` + `http://localhost:3000/api/health` returns `{"ok":true}`.

The deployed app uses the **same Supabase database**, so migrations only need to be
run once — not again per environment.

## 2. Import the repo on Vercel

1. Push this branch to GitHub (already done).
2. Vercel → **Add New… → Project** → import the repo.
3. Framework preset: **Next.js** (auto-detected). Leave build/output settings default
   (`next build`, no overrides).

## 3. Set environment variables (Project → Settings → Environment Variables)

Add these for the **Production** (and Preview, if you want) environment:

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public. `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public. Supabase publishable / anon key |
| `ANTHROPIC_API_KEY` | **Secret.** `sk-ant-...` |
| `ALPACA_KEY_ID` | **Secret.** Paper key id |
| `ALPACA_SECRET_KEY` | **Secret.** Paper secret |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets/v2` |
| `GRADE_DAILY_LIMIT` | Optional, default 50 |
| `HEALTH_CHECK_TOKEN` | Optional. Required to call `/api/health?token=...` in production |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, not currently used by the app |

Only the `NEXT_PUBLIC_*` vars reach the browser; the rest stay server-side.

## 4. Configure Supabase auth for the production domain

In Supabase → **Authentication → URL configuration**:

- **Site URL**: `https://<your-app>.vercel.app`
- **Redirect URLs**: add both
  - `https://<your-app>.vercel.app/auth/callback`
  - `http://localhost:3000/auth/callback` (keep for local dev)

The app builds its email-confirmation redirect from `window.location.origin`, so it
adapts to whatever domain it's served from — no code change between local and prod.

## 5. Deploy & verify

1. Trigger the deploy (automatic on push, or **Deploy** in Vercel).
2. Once live, verify dependencies. With `HEALTH_CHECK_TOKEN` set:
   `https://<your-app>.vercel.app/api/health?token=<token>` → expect `{"ok":true}`.
3. Sign up → Stage 1 (SOP) → Stage 2 (grade a trade) → Stage 3 (checklist + order).

## Notes

- **First grade is slow-ish**: Opus 4.7 with adaptive thinking + a new structured-output
  schema compiles on first use, then caches for 24h.
- **Alpaca crypto** orders require `gtc`/`ioc` time-in-force (not `day`); the order form
  lets you pick, but a crypto `day` order will be rejected by Alpaca.
- **Cost**: grading uses Opus 4.7. `GRADE_DAILY_LIMIT` caps per-user daily grades; check
  spend via `/api/usage`.
- Rotate the Alpaca secret if it was ever shared in plaintext.
