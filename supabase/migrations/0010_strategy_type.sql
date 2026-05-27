-- Identifies which learner strategy template populated a user's SOP.
-- Default 'custom' = the user is building their own rules.
alter table public.sops
  add column if not exists strategy_type text not null default 'custom';

notify pgrst, 'reload schema';
