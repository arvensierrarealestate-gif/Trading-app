-- Records which strategy each paper trade was graded against, so the journal
-- can show a per-trade strategy pill and compare average scores by strategy.
alter table public.paper_trades
  add column if not exists strategy_type text;

notify pgrst, 'reload schema';
