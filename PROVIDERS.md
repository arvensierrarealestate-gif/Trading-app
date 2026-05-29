# Data providers — what's stubbed and how to light it up

Everything in the app works on free price data (Yahoo Finance) plus Alpaca paper
and Anthropic. A handful of features need a paid/keyed market-data provider.
Until a key is added, each shows an honest **"needs provider"** state in the UI
— never fabricated numbers.

This doc lists every gated feature: the provider that covers it, the endpoint to
call, the env var to add, and the exact file where it plugs in.

---

## Recommended: one provider covers almost everything

**Polygon.io** (https://polygon.io) — stocks **and** options **and** news under a
single key. A paid "Options Starter"/"Stocks Starter" tier covers all the gated
features below. This is the lowest-friction choice.

**Alternative: Tradier** (https://tradier.com) — options-focused brokerage API
(chains, Greeks, IV) + quotes. Good if you also want real-money options later.
Doesn't do news; pair it with a news API.

Add the key in **Vercel → Settings → Environment Variables** (Production), then
redeploy without build cache.

---

## 1. Bid / Ask + day quote precision

- **Where it shows:** Ticker detail panel → quote grid ("Bid / Ask" = *needs provider*).
- **Provider:** Polygon (`/v3/quotes/{ticker}` or snapshot) or Tradier (`/v1/markets/quotes`).
- **Env var:** `POLYGON_API_KEY` (or `TRADIER_API_KEY`).
- **Plug-in point:** `src/app/api/quote/route.ts` — currently returns `bid: null, ask: null`. Fetch the provider snapshot and fill them.

## 2. Open interest (and full options chain)

- **Where it shows:** Ticker detail panel → "Open interest" = *needs provider*; the CALLS/PUTS pills marked `n/a` across positions, recommendations, and the ticker card.
- **Provider:** Polygon (`/v3/snapshot/options/{underlying}`) or Tradier (`/v1/markets/options/chains`).
- **Env var:** `POLYGON_API_KEY` (or `TRADIER_API_KEY` + `TRADIER_ACCOUNT_ID`).
- **Plug-in points:**
  - `src/app/api/quote/route.ts` → `open_interest`.
  - `src/app/api/ticker/route.ts` → fills `ticker_cache.calls_suitable` / `puts_suitable` and the `calls_available` / `puts_available` / `options_available` flags in `src/lib/ticker.ts` (`TickerMetrics`).

## 3. IV rank + put/call ratio (real options aggression)

- **Where it shows:** Ticker card / recommendations / detail panel — IV rank and put/call currently null; CALLS/PUTS badges say "needs options provider".
- **Provider:** Polygon options snapshot (implied volatility per contract → compute IV rank over trailing year) or Tradier (`greeks`/`iv` on the chain).
- **Env var:** `POLYGON_API_KEY` (or `TRADIER_API_KEY`).
- **Plug-in point:** `src/app/api/ticker/route.ts` — set `iv_rank` and `put_call_ratio` (cached in `ticker_cache`), and factor them into the aggression score in `src/lib/ticker.ts` (`scoreAggression`).

## 4. News headlines (5 per ticker)

- **Where it shows:** Ticker detail panel → News section ("Headlines require a news provider"). (Note: traders can already *paste* catalyst text into Stage 2 — this is the automatic-fetch version.)
- **Provider:** Polygon (`/v2/reference/news?ticker=`), Finnhub (`/company-news`), or NewsAPI (`/v2/everything`).
- **Env var:** `POLYGON_API_KEY` (reuse) or `NEWS_API_KEY`.
- **Plug-in point:** add a new route `src/app/api/news/route.ts` returning `{ headlines: [{title, url, source, published}] }`; render it in `src/components/TickerDetailPanel.tsx` (replace the `.td-stub` News block).

## 5. Options overlays + "Roll" button

- **Where it shows:** Ticker detail panel → "Options strategy overlays (EMA/RSI/IV) need an options data provider" and the disabled **Roll** button.
- **Note:** EMA/RSI overlays are price-based and *could* be drawn from Yahoo data already; the **IV overlay and Roll** specifically need options data + an options-capable broker.
- **Provider:** Polygon/Tradier for the options data; **Alpaca** does **not** trade options on the standard paper key, so "Roll" needs an options-enabled broker (Tradier paper supports options).
- **Env vars:** `TRADIER_API_KEY` + `TRADIER_ACCOUNT_ID` (for placing/rolling options orders), or `POLYGON_API_KEY` (data only).
- **Plug-in point:** `src/components/TickerDetailPanel.tsx` (overlays + Roll button) and a new orders path for options.

---

## Morning brief — premium-selling IV line

- **Where it shows:** Learner morning brief, premium-selling strategy → "IV rank requires an options data provider…".
- **Fix:** once #3 is wired, replace the note in `src/app/api/strategy-brief/route.ts` (`premium_selling` block) with the real SPY IV rank.

---

## Summary table

| Feature | Provider | Env var(s) | Code file |
|---|---|---|---|
| Bid / Ask | Polygon / Tradier | `POLYGON_API_KEY` | `api/quote/route.ts` |
| Open interest + chain | Polygon / Tradier | `POLYGON_API_KEY` | `api/quote`, `api/ticker` |
| IV rank + put/call | Polygon / Tradier | `POLYGON_API_KEY` | `api/ticker/route.ts`, `lib/ticker.ts` |
| News headlines | Polygon / Finnhub / NewsAPI | `POLYGON_API_KEY` or `NEWS_API_KEY` | new `api/news/route.ts` + `TickerDetailPanel.tsx` |
| Options overlays + Roll | Polygon (data) + Tradier (orders) | `TRADIER_API_KEY`, `TRADIER_ACCOUNT_ID` | `TickerDetailPanel.tsx` |

**Fastest path:** add a single `POLYGON_API_KEY` → features 1–4 light up. Add
Tradier only if you want real options orders (#5).
