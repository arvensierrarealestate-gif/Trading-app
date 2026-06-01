-- Stripe subscription state on profiles.
-- subscription_status reflects the Stripe customer's current status; tier is
-- the product they're on; period_end is when the current paid period expires
-- (so the app can keep them on the paid tier until then even after cancel).

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_status text not null default 'free',
  add column if not exists subscription_tier text,
  add column if not exists subscription_current_period_end timestamptz;

create unique index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

notify pgrst, 'reload schema';
