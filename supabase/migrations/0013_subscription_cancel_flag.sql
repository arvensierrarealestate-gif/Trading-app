-- Track Stripe's cancel_at_period_end flag. When true, the subscription is
-- still active (and the user keeps Pro access) until the period ends, after
-- which Stripe sends customer.subscription.deleted. The UI uses this to
-- switch the renewal copy from "Renews" to "Access until".
alter table profiles
  add column if not exists subscription_cancel_at_period_end boolean not null default false;
