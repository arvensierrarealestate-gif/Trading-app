-- Adds the learner/trader experience mode to a user's profile.
-- Nullable: a null value means the user hasn't chosen yet, which triggers the
-- mode-selection screen after signup.

alter table public.profiles
  add column if not exists trading_mode text
    check (trading_mode is null or trading_mode in ('learner', 'trader'));
