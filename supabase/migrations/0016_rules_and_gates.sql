-- Migration 0016 — Rules and gates update Jun 29, 2026
-- Updates B2 approved tickers, B2 gate system (9 gates),
-- B3 approved tickers, B3 gate system, and ticker-specific rules

-- ── B2 APPROVED TICKERS ──────────────────────────────────────────
-- Replace any existing B2 ticker list with this exact set:
-- SOXL · TQQQ · TNA · NVDL · TSLL · PYPL · GUSH · SPCX
-- Rules:
--   PYPL — permanently approved, always include, never omit
--   GUSH — limit orders only (no market orders), thin OI, added Jun 3
--   SPCX — new IPO Jun 19, daily stop monitoring, no set-and-forget
--   NVDL — R1 MA5010 stop test required every session before entry

-- ── B3 APPROVED TICKERS ──────────────────────────────────────────
-- Replace any existing B3 ticker list with this exact set (Jan 2028 only):
-- NVDA · META · GOOGL · AMZN · AVGO · MSFT · AMD · VRT · ARM · PATH
-- Scan order is fixed. PATH is ALWAYS last, no exceptions.
-- Actual stored order: NVDA, META, GOOGL, AMZN, AVGO, MSFT, AMD, VRT, ARM, PATH

-- ── B2 GATES TABLE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2_gates (
  id SERIAL PRIMARY KEY,
  gate_code TEXT NOT NULL UNIQUE,      -- e.g. 'R2.3'
  gate_name TEXT NOT NULL,             -- e.g. 'VIX Gate'
  description TEXT,
  pass_condition TEXT,
  fail_condition TEXT,
  caution_condition TEXT,
  sort_order INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO b2_gates (gate_code, gate_name, description, pass_condition, fail_condition, caution_condition, sort_order) VALUES
('R2.3',  'VIX Gate',         'VIX level determines B2 window status',
 'VIX 18–25 = prime window PASS',
 'VIX >25 = NO TRADE',
 'VIX <18 = caution (window closed)',
 1),

('R2.7',  'RSI Gate',         'RSI determines entry quality',
 'RSI 30–40 = BEST · RSI 40–55 = ACCEPTABLE',
 'RSI >70 = SKIP · RSI <30 = WAIT (elevated risk on leveraged ETFs)',
 'RSI 55–70 = CAUTION (requires IV>HV by 10+ pts to proceed)',
 2),

('R2.3b', 'IV vs HV Gate',    'IV30 must lead HV30 for safe premium collection',
 'IV30 > HV30 = PASS',
 'HV30 > IV30 = FAIL (premium underprices realized risk)',
 'HV30 > IV30 by <3 pts = borderline caution only',
 3),

('R2.6',  'P/C Ratio Gate',   'Put/Call ratio direction check',
 'P/C < 1.0 = PASS (calls dominant, market not hedging)',
 'P/C > 2.0 = FAIL (extreme put buying)',
 'P/C 1.0–2.0 = CAUTION',
 4),

('R2.20', 'MACD Weekly Gate', 'MACD weekly signal line position',
 'MACD above signal AND above zero = STRONG PASS · Above signal only = PASS',
 'MACD below signal AND below zero = SKIP',
 'MACD below signal but above zero = CAUTION (need RSI <40)',
 5),

('R2.21', 'ROI Floor Gate',   'Annualized ROI must clear 30% minimum',
 'ROI = (Bid÷Strike)×(365÷DTE)×100 ≥ 30% = PASS',
 'ROI < 30% = FAIL',
 'ROI 28–30% = borderline caution',
 6),

('R2.8',  'DTE + Delta Gate', '30–45 DTE and delta 0.20–0.30 both required',
 'DTE 30–45 AND delta 0.20–0.30 = PASS',
 'DTE outside 30–45 OR delta outside 0.20–0.30 = FAIL',
 'DTE 25–30 accepted only when R2.17 earnings constraint forces it',
 7),

('R2.11', 'Correlation Gate', 'Prevent correlated position concentration',
 'No correlation conflict with open positions = PASS',
 'SOXL + TQQQ + NVDL open simultaneously = FAIL',
 'TSLL + TNA is the ONLY safe dual position',
 8),

('R2.5',  'Calendar Gate',    'No macro events on entry day',
 'No FOMC/CPI/NFP today or tomorrow = PASS · 30-min post-open wait applies',
 'FOMC/CPI/NFP today or tomorrow = NO TRADE',
 NULL,
 9);

-- ── B2 EXIT RULES TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2_exit_rules (
  id SERIAL PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  rule_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO b2_exit_rules (rule_code, rule_name, description) VALUES
('R2.9',   'GTC Profit Target',     'Buy to Close at 50% of premium collected. Set GTC within 60 seconds of fill. Primary exit.'),
('R2.9E',  'Early Close',           'Close at 25% if higher-ROI redeploy is approved by owner.'),
('R2.9L',  'Late DTE Evaluation',   '<21 DTE with no 50% trigger — evaluate manual close. Do not set-and-forget.'),
('R2.16',  'Manual Stop',           'Close if position moves past 2× premium collected. Manual day order in IRAs (no GTC allowed).'),
('R2.17',  'Earnings Blackout',     'Never hold through underlying earnings event. Exit before print.'),
('R2.10',  'Position Limit',        'Max 1 open position per ticker. Max 2–3 total open B2 positions.'),
('R2.13',  'Cash Secured Only',     'Never use margin. Collateral must be sitting in cash (SPAXX).'),
('R2.18',  'Cash Reserve',          'Maintain 30% minimum cash reserve in the trading account at all times.'),
('R2.19',  'Single Ticker Cap',     'Never more than 20% of total capital on any single ticker.');

-- ── B3 GATES TABLE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b3_gates (
  id SERIAL PRIMARY KEY,
  gate_code TEXT NOT NULL UNIQUE,
  gate_name TEXT NOT NULL,
  description TEXT,
  pass_condition TEXT,
  fail_condition TEXT,
  caution_condition TEXT,
  sort_order INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO b3_gates (gate_code, gate_name, description, pass_condition, fail_condition, caution_condition, sort_order) VALUES
('R3.1',  'Approved List',         'Ticker must be on the approved B3 list. Hard stop before all other gates.',
 'Ticker on approved list = proceed to gates',
 'Ticker NOT on approved list = HARD STOP. No analysis, no chain pull, nothing.',
 NULL,
 1),

('R3.2',  'Pullback Gate',         'Blood-in-streets entry zone. Price must be 10–25% below recent highs.',
 '10–25% below recent high = PASS (blood-in-streets entry)',
 '<10% off high = FAIL (not enough pullback) · >25% = borderline/caution depending on ATH age',
 '>25% with very recent ATH = borderline pass with caution',
 2),

('R3.3',  'VIX Gate',              'VIX must be below 22 at time of B3 entry.',
 'VIX < 22 = PASS',
 'VIX ≥ 22 = FAIL',
 NULL,
 3),

('R3.4',  'IV Gate',               'IV30 must not severely underprice realized volatility.',
 'IV30 > HV30 = PASS · IV30 within 10 pts of HV30 = acceptable',
 'HV30 > IV30 by >10 pts = FAIL (options severely underpricing realized risk)',
 'HV30 > IV30 by 1–10 pts = CAUTION (monitor, not automatic fail)',
 4),

('R3.5',  'Earnings Runway',       'No earnings inside expiry window. Must exit 3 days before print.',
 'Earnings >60 days away OR expiry clears earnings by 3+ days = PASS',
 'Earnings within 30 days of entry = BLOCK (26-day hold on 571-day LEAPS is poor capital efficiency)',
 NULL,
 5),

('R3.6',  'Delta at Entry',        'Delta 0.60–0.70 at entry on all new B3 LEAPS. Ashley framework standard.',
 'Delta 0.60–0.70 at entry = PASS',
 'Delta > 0.70 or < 0.60 = FAIL (OOR)',
 'Delta 0.58–0.60 = borderline caution · evaluate strike options',
 6),

('R3.7',  'Roll Trigger',          'Roll when delta reaches 0.80–0.85. Target Jan 2029/Jun 2028 at 0.60–0.70. Roth IRA priority.',
 'Delta 0.80–0.85 reached = evaluate roll to Jan 2029/Jun 2028 at 0.60–0.70',
 NULL,
 'Roth IRA is priority account for rolls (tax-free compounding per Ashley framework)',
 7),

('R3.8',  'Capital Reserve',       'B3 capital minimum 30% in SPAXX at all times. B3-capital-only (not portfolio-wide).',
 'B3 SPAXX reserve ≥ 30% of B3 capital post-entry = PASS',
 'B3 SPAXX reserve < 30% post-entry = NO ENTRY',
 NULL,
 8),

('R3.17', 'Earnings Binary',       'Never hold any B3 position through an earnings event. Non-negotiable.',
 'Position closed 3 days before earnings = PASS',
 'Holding through earnings = FAIL. IRA gap risk is unmanageable.',
 NULL,
 9),

('R3.19', 'Thesis Monitor',        'Company-specific bad news breaking the core thesis → exit immediately.',
 'Thesis intact = continue holding',
 'Thesis broken by company-specific news = exit immediately (not macro/sector)',
 'Regulatory risk, analyst downgrades = elevated monitoring only (not automatic exit)',
 10),

('R3.20', 'No Averaging Down',     'Never average down into a losing B3 position. Absolute rule.',
 NULL,
 'Position down + adding more = ABSOLUTE FAIL. No exceptions.',
 NULL,
 11);

-- ── B3 EXIT / TRAIL RULES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b3_rules (
  id SERIAL PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  rule_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO b3_rules (rule_code, rule_name, description) VALUES
('R3.10', 'Stop Rule',           'Standard: fill × 0.60. High-volatility names (CRDO, post-META lesson): fill × 0.55. GTC set same minute as fill in Individual account only (IRAs do not support GTC).'),
('R3.10L','Activation Lock',     '30-day activation lock on all new B3 entries. Stop is not active until 30 days post-fill. Post-META post-mortem lesson.'),
('R3.11', 'Profit Target',       'GTC sell 50% of contracts at +100% gain. Set same minute as fill.'),
('R3.12', 'Trail 1',             'At +50% mark → move stop to breakeven immediately.'),
('R3.13', 'Trail 2',             'At +150% → trail stop to +50% gain.'),
('R3.14', 'Trail 3',             'At +200% → trail stop to +100% gain.'),
('R3.15', 'Size Rule',           'Start with 1 contract. Add only on further pullbacks (R3.2 re-qualifying). Never chase.'),
('R3.17', 'Hard Exit',           'Exit ALL contracts 3 days before earnings. Manual close — do not wait for GTC. Non-negotiable in IRAs.'),
('R3.18', 'Staged Exit',         'Sell 50% at +100%. Never sell all at once. Let remainder run with trail stop.'),
('R3.20', 'No Avg Down',         'Never average down into a losing B3 position. Period.');

-- ── LEARNED RULES / SYSTEM ADAPTATIONS ──────────────────────────
CREATE TABLE IF NOT EXISTS system_rules (
  id SERIAL PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,   -- 'session_protocol' | 'ira_rule' | 'fidelity_rule' | 'post_mortem' | 'capital'
  rule_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_rules (rule_code, category, rule_name, description) VALUES
('SR.1',  'session_protocol',  '30-Minute Wait Rule',
 'Always wait 30 minutes after market open before executing any B2 or B3 entry. Pre-market GO signals can flip bearish within 30 minutes of open.'),

('SR.2',  'ira_rule',          'IRA No-GTC Rule',
 'No GTC orders in Trad IRA 250571235 or Roth IRA 244967542. Individual Z33181037 only supports GTC. All IRA position monitoring = manual Day orders or 9:55 AM checks.'),

('SR.3',  'fidelity_rule',     'One-GTC-Per-Ticker Rule',
 'Stop and profit target cannot coexist on same ticker in Fidelity. Default = stop first. Switch to profit target only when position is up 30%+ and stop risk is acceptably low.'),

('SR.4',  'post_mortem',       'Post-META Stop Adjustment',
 'Stop at fill×0.55 (not fill×0.65) for high-volatility B3 names. Root cause of META stop-out: stop too tight + no time lock. Now: fill×0.55 stop + 30-day activation lock on all new B3 entries.'),

('SR.5',  'session_protocol',  'Session Opening Protocol',
 'Every session in order: (1) NVDL R1 MA5010 stop test at 9:55 AM. (2) Check all open IRA positions manually. (3) Check SPCX daily stop. (4) Check RKLB price + 30-day post-IPO countdown. (5) Run B2 scan (8 tickers in order). (6) Run B3 scan (10 tickers, PATH always last).'),

('SR.6',  'capital',           'Capital Sequencing Rule',
 'Even when all gates pass (e.g. PYPL 9/9), hold entry if higher-priority capital deployments are pending within the same window. $25 profit on $4,200 collateral is subordinate to preserving capital for larger B3 entries (CRDO, META, AVGO).'),

('SR.7',  'session_protocol',  'NVDL R1 Stop Test',
 'NVDL-specific: Fidelity MA5010 stop test must be run at 9:55 AM each session before any NVDL entry attempt. If blocked by error = no entry that day only (not permanent removal from scan).'),

('SR.8',  'ira_rule',          'B3 Hard Exit in IRA',
 'In Trad IRA: no pre-market orders, no GTC stops. If a B3 position approaches earnings, exit must be planned as a manual Day order on the designated exit date. IRA gap risk from earnings binary is unmanageable.'),

('SR.9',  'post_mortem',       'Inclusion Spike Rule',
 'Never enter a B3 LEAPS position during a rapid price spike driven by index inclusion, analyst PT upgrade, or momentum chasing. P/C ratio and MACD must confirm before entry. The spike itself is the warning, not the signal.'),

('SR.10', 'capital',           'B2.5 Scalp RS.2 Guard',
 'Hardest guard in the scalp system: no B2.5 scalp under any circumstances until the NVDA $210C ×4 Jan28 mark reaches ≥$55.54 (fill price). No exceptions regardless of market conditions.');

-- ── TICKER-SPECIFIC RULES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticker_rules (
  id SERIAL PRIMARY KEY,
  ticker TEXT NOT NULL,
  bucket TEXT NOT NULL,       -- 'B2' | 'B3' | 'B2+B3'
  rule_type TEXT NOT NULL,    -- 'entry' | 'stop' | 'exit' | 'monitoring' | 'permanent'
  rule_text TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO ticker_rules (ticker, bucket, rule_type, rule_text) VALUES
('PYPL', 'B2', 'permanent',   'Permanently approved. Always include in B2 scan. Never omit. Earnings blackout applies per R2.17.'),
('GUSH', 'B2', 'permanent',   'Limit orders only — no market orders. Thin OI makes market orders dangerous. Added Jun 3, 2026.'),
('SPCX', 'B2', 'monitoring',  'New IPO Jun 19, 2026. Daily stop monitoring at 9:55 AM every session. No set-and-forget. Share buy window ~Jul 10 (2–5 shares stabilized). CSP entry only after 30-day post-IPO stabilization.'),
('NVDL', 'B2', 'entry',       'R1 MA5010 Fidelity stop test required at 9:55 AM before every entry attempt. If test errors = no entry that session only. Double-leverage: NVDA -2.34% = NVDL -5.44%. GTC stop same minute as fill.'),
('CRDO', 'B3', 'entry',       'Approved Jun 19. Entry blocked until $247.41 alert fires. Instrument: $250C Jan28. Stop: fill×0.55 (not 0.60). Hard exit Aug 30. 30-day activation lock. Enter same session alert fires — no delay.'),
('ALAB', 'B3', 'entry',       'RU.4 deferred post-Aug 3 earnings. Inclusion spike rule active. ATH $440.99 Jun 22. Do not enter on price spike. Alerts: $370/$340. Full gate check only after RU.4 complete.'),
('PATH', 'B3', 'permanent',   'Always last in B3 scan — no exceptions. Share hold only at current price level. LEAPS viable when price recovers to $15–$18. RU.4 approval status to verify.'),
('ARM',  'B3', 'monitoring',  'C-skip confirmed. HV30 must normalize below 90 before LEAPS entry is viable. Alerts: $342.39/$320.99. Aug 1 re-eval.'),
('VRT',  'B3', 'entry',       'C-skip confirmed. Conditional entry: if drops to $304, evaluate $310C Jan28. $304 breached Jun 29 ($300.50). Aug 1 re-eval post-Jul 28 earnings. Hard exit Jul 25 boundary.'),
('MSFT', 'B3', 'entry',       'Deferred Aug 1–10. 52-wk low $349.20 printed Jun 25. Target $350C Jan28 (OI 2,392, delta 0.6663). Alert updated to $349.20. Earnings Jul 28 blocks today — Aug 1 entry window.'),
('AVGO', 'B3', 'monitoring',  'Monitor only — no open position. RU.4 complete. $380C Jan28 target. $445 ceiling alert active. Entry blocked: MACD MaCdSE -2 + HV>IV 18.73 pts. Re-eval mid-to-late July.'),
('META', 'B3', 'entry',       'Strategy B: wait post-earnings Jul 29. $5,029 SPAXX staged in Trad IRA. Target $560C Jan28 (delta 0.6674). Hard exit Jul 25 boundary. Go/No-Go Jun 30.'),
('AMD',  'B3', 'entry',       'Deferred Aug 4–10. Earnings Aug 3. Alert $489.64 (R3.2 trigger) and $409.83 (deep zone). Target $530C Jan28 (delta 0.6962). P/C 1.16 caution signal.');
