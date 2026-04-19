-- ============================================================
-- Kinvox — Stripe Billing Migration
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

alter table public.organizations
  add column if not exists stripe_customer_id  text,
  add column if not exists subscription_status text not null default 'unpaid'
    check (subscription_status in ('unpaid', 'trialing', 'active', 'past_due', 'canceled'));

comment on column public.organizations.stripe_customer_id  is 'Stripe customer ID (cus_xxx)';
comment on column public.organizations.subscription_status is 'Mirrors Stripe subscription status; manually set until webhook is wired';
