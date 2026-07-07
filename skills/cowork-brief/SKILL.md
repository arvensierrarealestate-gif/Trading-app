---
name: cowork-brief
description: Run the TradeReady Cowork trading routine from chat — morning brief, bucket status (B1 autofill, B2 CSP, B3 LEAPS, B4 day-trade), and B4 multi-timeframe success scores — by calling the deployed app API. Trigger on "morning brief", "run my brief", "session start", "check my buckets", "cowork status", "B4 scan", "day trade scan", "where are my buckets", "what do we have today".
---

# TradeReady Cowork — Trading Brief Skill

This skill drives the SAME backend the web app uses, so the desktop/chat
routine and the browser (`/cowork`) stay in sync — two front doors, one source
of truth. It only READS and formats; it never places trades.

## Configuration (set once)

- **Base URL:** `https://trading-app-alpha-henna.vercel.app`
- **Auth:** a bearer token stored in the environment variable `COWORK_API_TOKEN`.
  - Send it as a header: `Authorization: Bearer $COWORK_API_TOKEN`.
  - **Never** put the token in a URL/query string, and **never** print it in chat.
- For the brief to reflect the real portfolio over token auth, the app env var
  `COWORK_USER_ID` must be set on the server. If it isn't, results fall back to
  the default watchlists (no owned positions) — still valid, just generic.

## Endpoints

1. **Full / partial morning brief** — human-readable report
   `POST /api/morning-brief/cowork`
   Body: `{"bucket":"all"}` (or `"b1"` | `"b2"` | `"b3"`)
   Returns `{ brief, diagnostics }`. Print `brief` verbatim.

2. **Today's status** — structured JSON
   `GET /api/cowork-status`
   Returns `regime`, `vix`, `has_portfolio`, `owned_options[]`, `owned_stocks[]`,
   `reentry[]`, `scalp`, `b1[]`, `b2[]`, `b3[]`, and `b4` (session window,
   futures bias, gate stack, go-live decisions, watchlist).

3. **B4 multi-timeframe success scores** — 2m/5m/15m/30m
   `GET /api/cowork/b4-mtf` (all watchlist tickers) or
   `GET /api/cowork/b4-mtf?symbol=NVDA` (one ticker)
   Returns `{ as_of, rows:[{ ticker, grade, overallBias, overallScore,
   confluence, timeframes:[{ tf, score, bias, rsi, volRatio, ... }] }] }`.

## How to run (map the user's phrase to calls)

- **"morning brief" / "run my brief" / "session start" / "what do we have today"**
  → `POST /api/morning-brief/cowork` with `{"bucket":"all"}` → print `brief`.
- **"b1 check" / "b2 check" / "b3 scan"** → same POST with that bucket.
- **"cowork status" / "where are my buckets"** → `GET /api/cowork-status` →
  summarize: regime + VIX, owned position flags (hard exits ≤14d, stops),
  any B2 GO / B3 NEAR ENTRY, and the B4 session line.
- **"B4 scan" / "day trade scan" / "success scores"** →
  `GET /api/cowork/b4-mtf` AND `GET /api/cowork-status`, then report:
  1. Session window + whether entries are allowed (from `b4.sessionLabel`).
  2. Futures bias (`b4.futures.combinedBias`) and any FAIL gates.
  3. The MTF table sorted by grade: `ticker · grade · bias · score · conf/4`,
     then the per-timeframe scores.

## curl reference

```bash
# Full brief
curl -s -X POST "$BASE/api/morning-brief/cowork" \
  -H "Authorization: Bearer $COWORK_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bucket":"all"}'

# Status
curl -s "$BASE/api/cowork-status" \
  -H "Authorization: Bearer $COWORK_API_TOKEN"

# B4 multi-timeframe scores
curl -s "$BASE/api/cowork/b4-mtf" \
  -H "Authorization: Bearer $COWORK_API_TOKEN"
```

## Output format

- For the brief: print the returned `brief` text as-is inside a code block.
- For status/scores: a tight summary first (one line of headline state), then a
  compact table. Lead with anything actionable (owned exits ≤14d, B2 GO,
  B3 NEAR ENTRY, B4 grade A/A+).

## Guardrails (do not violate)

- **B4 is documented but NOT live.** Never suggest or simulate placing a live
  trade. Report signals only; entries are the owner's manual decision.
- **B4 gates G3–G7 are manual** (level break, volume, catalyst, liquidity, order
  flow). The scores tell you *where to look*, never *when to click*.
- **MTF intraday scores are meaningful only during market hours** (09:30–16:00 ET,
  Mon–Fri). Outside that, note that scores reflect the last session.
- **Never echo `COWORK_API_TOKEN`** or any secret in output.
- **Saving levels** (bull/bear/targets) is web-UI only — it needs a login
  session, not the token. Direct the user to `/cowork?tab=b4` for that.
