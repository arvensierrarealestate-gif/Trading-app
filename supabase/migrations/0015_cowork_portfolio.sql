-- Cowork three-bucket trading system portfolio. Owned positions + 5 monitoring
-- lists stored as a single JSONB document keyed by user_id, so the entire
-- pasted document is one round-trip to save or load. Schema validation happens
-- in the application layer via Zod (src/lib/cowork-portfolio.ts).
create table if not exists public.cowork_portfolio (
  user_id uuid primary key references auth.users on delete cascade,
  document jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.cowork_portfolio enable row level security;

create policy "Users read own portfolio"
  on public.cowork_portfolio for select
  using (auth.uid() = user_id);

create policy "Users insert own portfolio"
  on public.cowork_portfolio for insert
  with check (auth.uid() = user_id);

create policy "Users update own portfolio"
  on public.cowork_portfolio for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
