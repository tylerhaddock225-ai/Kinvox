-- Kinvox — Subscription cancellation scaffolding
--
-- Pre-Stripe: we only record the tenant's *intent* to cancel (flag) and
-- an optional period-end timestamp for the UI copy. When Stripe ships the
-- webhook that carries the real subscription object, current_period_end
-- is kept in sync and cancel_at_period_end mirrors Stripe's canonical
-- value. Until then both columns are set purely by tenant action.

alter table public.organizations
  add column if not exists cancel_at_period_end boolean     not null default false;

alter table public.organizations
  add column if not exists current_period_end   timestamptz;
