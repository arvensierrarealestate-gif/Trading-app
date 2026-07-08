-- Migration 0018 — B4 refinements (MasiTrades + FOMC/Bookmap) · encoded 2026-07-08
-- Canonical ruleset lives in src/lib/b4-rules.ts; this keeps the DB reference
-- tables in sync. Adds the G0 event lock, tightens G2/G4/G7, and records the
-- new trade-management rules (R4.9 min-scale, R4.10 retest, paired stops,
-- event-day scale ratio).

-- ── G0 Event lock (checked before all other gates) ───────────────────────
INSERT INTO b4_gates (gate_code, gate_name, detail, automatable, sort_order) VALUES
('R4.G0', 'Event lock',
 'FOMC/CPI/PCE/NFP days: no entry until AFTER the release AND price confirms direction. FOMC = two events (2PM release + 2:30 Powell). Checked before all other gates.',
 FALSE, 0)
ON CONFLICT (gate_code) DO UPDATE SET detail = EXCLUDED.detail, sort_order = EXCLUDED.sort_order;

-- ── Tighten existing gates ───────────────────────────────────────────────
UPDATE b4_gates SET detail =
  'ES AND NQ must BREAK their own mapped S/R levels in confluence with the instrument level — not just sit on one side of VWAP.'
  WHERE gate_code = 'R4.G2';

UPDATE b4_gates SET gate_name = 'Volume + fake-breakout filter', detail =
  'Volume rises at the break AND aggressive order flow follows in the break direction. No follow-through = fake, even on decent volume, so skip.'
  WHERE gate_code = 'R4.G4';

UPDATE b4_gates SET gate_name = 'Wait for absorption', detail =
  'Wait for the defending wall to be COMPLETELY absorbed before entry. Trigger = wall gone, not wall present.'
  WHERE gate_code = 'R4.G7';

-- ── New trade-management rules ───────────────────────────────────────────
INSERT INTO b4_rules (rule_code, rule_name, detail, sort_order) VALUES
('R4.9',  'Minimum contracts to scale',
 'Below 7 contracts, do not scale out — exit 100% at Target 1. Scaling only makes sense with enough size.', 9),
('R4.10', 'Pullback retest read',
 'After a break: a retest that is rejected (level defended) is a valid add / second entry. A retest that reclaims the broken level = exit, the break is failing.', 10),
('R4.11', 'Paired stop',
 'Exit if EITHER trigger fires: the daily dollar loss cap (R4.2) OR a level-reclaim structure stop (price reclaims the broken level).', 11)
ON CONFLICT (rule_code) DO UPDATE SET detail = EXCLUDED.detail, rule_name = EXCLUDED.rule_name, sort_order = EXCLUDED.sort_order;

-- ── Event-day scale ratio (80/10/10) alongside normal 70/20/10 ───────────
INSERT INTO b4_exit_plan (exit_no, size_pct, target_ref, detail) VALUES
(1, 70, 'Target 1', 'Normal 70/20/10. Options typically up ~40–60%. Event days (FOMC/CPI/PCE/NFP) use 80/10/10 — reversals come faster.')
ON CONFLICT (exit_no) DO UPDATE SET detail = EXCLUDED.detail;

-- Note: event-day ratio and the <7-contract override are enforced in code
-- (b4-rules.ts: scaleRatio() / exitPlan()); stored here for reference only.
