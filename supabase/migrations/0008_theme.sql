-- Persisted theme preference per user.
alter table public.profiles
  add column if not exists theme text default 'dark-terminal';
