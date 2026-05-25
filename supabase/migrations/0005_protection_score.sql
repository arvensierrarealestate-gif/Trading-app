-- Protection layer for learner-mode paper trades: stores the risk-management
-- sub-scores separately so a trade can be excluded from go-live progress when
-- capital was not protected.

alter table public.paper_trades
  add column if not exists stop_loss_price text,
  add column if not exists protection_score smallint not null default 0,
  add column if not exists stop_loss_set boolean not null default false,
  add column if not exists stop_loss_placement smallint not null default 0,
  add column if not exists position_size_ok boolean not null default false;
