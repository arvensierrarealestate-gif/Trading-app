-- Tracks billable AI calls (grading) for cost visibility and per-user daily caps.

create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'grade',
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists api_usage_user_day_idx on public.api_usage(user_id, created_at desc);

alter table public.api_usage enable row level security;

do $$ begin
  drop policy if exists "api_usage self read" on public.api_usage;
  drop policy if exists "api_usage self insert" on public.api_usage;
end $$;

create policy "api_usage self read" on public.api_usage for select using (auth.uid() = user_id);
create policy "api_usage self insert" on public.api_usage for insert with check (auth.uid() = user_id);
