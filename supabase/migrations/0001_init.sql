-- TradeReady initial schema
-- Run in Supabase SQL editor or via `supabase db push`.

create extension if not exists "pgcrypto";

-- profiles: extends auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  current_stage smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- sops: one SOP per user
create table if not exists public.sops (
  user_id uuid primary key references auth.users(id) on delete cascade,
  assets text not null default '',
  tf text not null default '4h',
  sessions text not null default '',
  entry_signals text not null default '',
  entry_confirm text not null default '',
  entry_notes text not null default '',
  tp text not null default '',
  sl text not null default '',
  rr text not null default '1:2',
  risk text not null default '1%',
  max_trades text not null default '2',
  drawdown text not null default '3%',
  updated_at timestamptz not null default now()
);

-- paper_trades: each Stage 2 submission
create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset text not null,
  dir text not null check (dir in ('Long','Short')),
  outcome text not null check (outcome in ('Win','Loss','Break even')),
  entry_price text,
  exit_price text,
  score smallint not null,
  verdict text not null,
  grade jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists paper_trades_user_idx on public.paper_trades(user_id, created_at desc);

-- go_live_checks: one row per user with which manual checks are ticked
create table if not exists public.go_live_checks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  manual_checks boolean[] not null default array[false,false,false,false,false,false]::boolean[],
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;
alter table public.sops enable row level security;
alter table public.paper_trades enable row level security;
alter table public.go_live_checks enable row level security;

-- Drop and recreate policies idempotently
do $$ begin
  drop policy if exists "profiles self read" on public.profiles;
  drop policy if exists "profiles self write" on public.profiles;
  drop policy if exists "profiles self insert" on public.profiles;
  drop policy if exists "sops self all" on public.sops;
  drop policy if exists "trades self all" on public.paper_trades;
  drop policy if exists "checks self all" on public.go_live_checks;
end $$;

create policy "profiles self read" on public.profiles for select using (auth.uid() = id);
create policy "profiles self insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles self write" on public.profiles for update using (auth.uid() = id);

create policy "sops self all" on public.sops for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trades self all" on public.paper_trades for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "checks self all" on public.go_live_checks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
