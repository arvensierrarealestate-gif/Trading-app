-- Trader verification: extracted history stats + a verified flag on the profile.

create table if not exists public.trader_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_trades integer,
  win_rate numeric,
  avg_win numeric,
  avg_loss numeric,
  max_single_loss numeric,
  max_drawdown numeric,
  primary_assets text,
  avg_hold_time text,
  verified boolean not null default false,
  verified_at timestamptz,
  verification_summary jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists verified boolean not null default false;

alter table public.trader_stats enable row level security;

do $$ begin
  drop policy if exists "trader_stats self all" on public.trader_stats;
end $$;

create policy "trader_stats self all" on public.trader_stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
