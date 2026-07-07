-- Migration 0017 — B4 Day Trading bucket (MasiTrades framework)
-- Adopted Jul 6 2026 · charting layer Jul 7 · cadence tailored to Mon–Fri Jul 7
-- Account: Individual Z33181037 ONLY · Status: documented, NOT yet live
-- B4 is the fourth bucket: B1 accumulates · B2 sells premium · B3 owns LEAPS ·
-- B4 day-trades intraday. Always scanned LAST (after B1 → B2 → B3).

-- ── B4 ACCOUNT & CAPITAL RULES ───────────────────────────────────
CREATE TABLE IF NOT EXISTS b4_rules (
  id SERIAL PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,      -- e.g. 'R4.1'
  rule_name TEXT NOT NULL,
  detail TEXT NOT NULL,
  sort_order INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO b4_rules (rule_code, rule_name, detail, sort_order) VALUES
('R4.1', 'Individual account only', 'Individual Z33181037 ONLY. IRAs blocked (PDT protection, no margin, slower fills).', 1),
('R4.2', 'Daily loss cap', 'Daily loss cap set before session. Once hit, session ends. No exceptions.', 2),
('R4.3', 'Capital ring-fence', 'B4 capital ring-fenced from B1/B2/B3. B4 losses never touch B2 collateral or B3 LEAPS.', 3),
('R4.4', 'Max 2 trades/day', 'Max 2 trades per day. Trade 1 hits max loss = session ends.', 4),
('R4.5', 'PDT rule', 'At most 3 round-trip day trades per 5 rolling days unless account stays above $25K.', 5)
ON CONFLICT (rule_code) DO UPDATE SET detail = EXCLUDED.detail, rule_name = EXCLUDED.rule_name;

-- ── B4 GATE STACK (all must pass before entry) ───────────────────
CREATE TABLE IF NOT EXISTS b4_gates (
  id SERIAL PRIMARY KEY,
  gate_code TEXT NOT NULL UNIQUE,      -- e.g. 'R4.G1'
  gate_name TEXT NOT NULL,
  detail TEXT NOT NULL,
  automatable BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = computed by evaluateB4
  sort_order INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO b4_gates (gate_code, gate_name, detail, automatable, sort_order) VALUES
('R4.G1', '10:00 AM rule',       'No entries before 10 AM ET. Hard, no exceptions.', TRUE, 1),
('R4.G2', 'Futures alignment',   'ES + NQ above VWAP+9EMA = calls; below both = puts; mixed = skip.', TRUE, 2),
('R4.G3', 'Key level break',     'Price must BREAK a pre-mapped S/R level (break + close). Not just approach.', FALSE, 3),
('R4.G4', 'Volume confirmation', 'Volume rises significantly at the break. Low volume = fake breakout = skip.', FALSE, 4),
('R4.G5', 'Catalyst check',      'News strengthens the setup. Never enter on catalyst alone.', FALSE, 5),
('R4.G6', 'Liquidity check',     'Options spread <= $0.20; shares spread <= $0.10. Wide spread = no trade.', FALSE, 6),
('R4.G7', 'Order flow',          'Confirm buyers/sellers dominating entry zone via absorption (Bookmap or proxy).', FALSE, 7),
('R4.G8', 'Daily loss cap',      'Confirm cap not hit before entering. If hit, no entry.', TRUE, 8)
ON CONFLICT (gate_code) DO UPDATE SET detail = EXCLUDED.detail, automatable = EXCLUDED.automatable;

-- ── B4 SESSION WINDOWS (ET) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS b4_session_windows (
  id SERIAL PRIMARY KEY,
  window_code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  et_start TEXT NOT NULL,               -- 'HH:MM' ET
  et_end TEXT NOT NULL,
  entries_allowed BOOLEAN NOT NULL,
  sort_order INT NOT NULL
);

INSERT INTO b4_session_windows (window_code, label, et_start, et_end, entries_allowed, sort_order) VALUES
('PRE_10AM',        'Open but pre-10 AM — no entries yet (R4.G1)', '09:30', '10:00', FALSE, 1),
('MORNING_ENTRY',   'Morning entry window',                        '10:00', '11:30', TRUE,  2),
('DEAD_ZONE',       'Midday dead zone — manage only (HR.2)',       '11:30', '13:30', FALSE, 3),
('AFTERNOON_ENTRY', 'Afternoon entry window',                      '13:30', '15:30', TRUE,  4),
('WIND_DOWN',       'Wind-down — close positions, no new',         '15:30', '15:45', FALSE, 5),
('CLOSED',          'Session closed — all flat (HR.3)',            '15:45', '16:00', FALSE, 6)
ON CONFLICT (window_code) DO UPDATE SET label = EXCLUDED.label, entries_allowed = EXCLUDED.entries_allowed;

-- ── B4 EXIT PLAN (70/20/10 scale-out) ────────────────────────────
CREATE TABLE IF NOT EXISTS b4_exit_plan (
  id SERIAL PRIMARY KEY,
  exit_no INT NOT NULL UNIQUE,
  size_pct INT NOT NULL,
  target_ref TEXT NOT NULL,
  detail TEXT NOT NULL
);

INSERT INTO b4_exit_plan (exit_no, size_pct, target_ref, detail) VALUES
(1, 70, 'Target 1', 'Options typically up ~40–60%. Lock the bulk, remove most risk.'),
(2, 20, 'Target 2', 'Add to locked profit.'),
(3, 10, 'Target 3', 'Runners.')
ON CONFLICT (exit_no) DO UPDATE SET size_pct = EXCLUDED.size_pct, detail = EXCLUDED.detail;

-- Momentum exit overrides all targets: futures reject / wicky price action /
-- opposing order flow appearing = exit immediately. Protection beats targets.

-- ── B4 HARD SESSION RULES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b4_hard_rules (
  id SERIAL PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  detail TEXT NOT NULL,
  sort_order INT NOT NULL
);

INSERT INTO b4_hard_rules (rule_code, detail, sort_order) VALUES
('HR.1', 'No trades before 10 AM ET', 1),
('HR.2', 'No trades 11:30 AM–1:30 PM (midday dead zone)', 2),
('HR.3', 'All positions closed by 3:45 PM ET', 3),
('HR.4', 'Stop trading after the daily max loss is hit', 4),
('HR.5', 'No forced trades. 0 trades = discipline pass', 5),
('HR.6', 'B4 never interferes with B2/B3 capital', 6)
ON CONFLICT (rule_code) DO UPDATE SET detail = EXCLUDED.detail;

-- ── B4 GO-LIVE DECISIONS (4 open before B4 goes live) ────────────
CREATE TABLE IF NOT EXISTS b4_golive_decisions (
  id SERIAL PRIMARY KEY,
  decision_no INT NOT NULL UNIQUE,
  decision_key TEXT NOT NULL,
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'   -- OPEN | SET
);

INSERT INTO b4_golive_decisions (decision_no, decision_key, label, required, note, status) VALUES
(1, 'loss_cap',   'Daily loss cap ($)',       TRUE,  'Hard R4.2/R4.G8/HR.4 number. Stops you emotionally without damaging B2/B3 capital.', 'OPEN'),
(2, 'flow_tool',  'Order-flow tool',          FALSE, 'Bookmap vs Fidelity Active Trader Pro proxy vs volume-spike proxy (default).', 'OPEN'),
(3, 'instrument', 'Launch instrument',        FALSE, 'SPX 0DTE vs single-stock. Recommended: start single-stock, add SPX 0DTE after a proven track record.', 'OPEN'),
(4, 'validation', 'Paper-trade validation',   TRUE,  'Paper-trade first (define window + go-live criteria) or go live with the small loss cap as guardrail.', 'OPEN')
ON CONFLICT (decision_no) DO UPDATE SET note = EXCLUDED.note, status = EXCLUDED.status;

-- Go-live gate: B4 places no live trade until (1) is set, (2)+(3) have at least
-- a default, and (4) is decided. When all four are locked, mark B4 LIVE.

-- These are reference tables (framework definitions), readable by the app.
-- No RLS needed — they hold no per-user data. Per-user B4 config (watchlist,
-- loss cap, level maps, live flag) lives in cowork_portfolio.monitor_B4_daytrade.
