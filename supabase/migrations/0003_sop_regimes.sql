-- Adds the market-regime filter to a trader's SOP.
-- Comma-separated subset of: crash, bear, neutral, bull.

alter table public.sops
  add column if not exists regimes text not null default 'neutral, bull';
