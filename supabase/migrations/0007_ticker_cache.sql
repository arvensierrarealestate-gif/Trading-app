-- Shared cache of price-derived ticker intelligence (options fields stay null
-- until an options data provider is configured).

create table if not exists public.ticker_cache (
  symbol text primary key,
  aggression_score smallint,
  scalp_suitable boolean,
  swing_suitable boolean,
  calls_suitable boolean,
  puts_suitable boolean,
  iv_rank numeric,
  put_call_ratio numeric,
  atr_pct numeric,
  beta numeric,
  last_updated timestamptz not null default now()
);

alter table public.ticker_cache enable row level security;

do $$ begin
  drop policy if exists "ticker_cache read" on public.ticker_cache;
  drop policy if exists "ticker_cache insert" on public.ticker_cache;
  drop policy if exists "ticker_cache update" on public.ticker_cache;
end $$;

-- Non-sensitive market data: any signed-in user may read and refresh it.
create policy "ticker_cache read" on public.ticker_cache for select using (auth.uid() is not null);
create policy "ticker_cache insert" on public.ticker_cache for insert with check (auth.uid() is not null);
create policy "ticker_cache update" on public.ticker_cache for update using (auth.uid() is not null);
