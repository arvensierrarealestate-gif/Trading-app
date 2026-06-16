-- Morning briefs generated daily by a Vercel cron (or on-demand from the UI).
-- One brief per user per UTC date — manual regenerate overwrites today's row.
create table if not exists public.morning_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  generated_at timestamptz not null default now(),
  date date not null default current_date,
  regime text,
  regime_confidence numeric,
  gates_passing int,
  strategy_signal text,
  recommendation text,
  full_brief text,
  unique (user_id, date)
);

create index if not exists morning_briefs_user_date_idx
  on public.morning_briefs (user_id, date desc);

alter table public.morning_briefs enable row level security;

create policy "Users read own briefs"
  on public.morning_briefs for select
  using (auth.uid() = user_id);

-- Writes are done by the service-role client from the cron / generate route,
-- so no insert/update policy is needed for authenticated users.
