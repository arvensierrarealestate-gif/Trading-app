-- User watchlist for the dashboard right rail and recommendations.
create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  symbol text not null,
  added_at timestamptz default now(),
  notes text,
  unique (user_id, symbol)
);

alter table public.watchlist enable row level security;

do $$ begin
  drop policy if exists "watchlist self all" on public.watchlist;
end $$;

create policy "watchlist self all" on public.watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
