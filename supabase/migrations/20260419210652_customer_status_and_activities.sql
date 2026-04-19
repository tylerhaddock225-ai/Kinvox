-- ============================================================
-- Migration: Customer status + customer_activities.
-- Brings the customer entity to parity with leads so the detail
-- page can mirror the lead detail UX.
--
-- Scope
--   • Add 'status' (text, default 'active') to public.customers.
--     UI presets: active | pending | onboarding | completed.
--     Kept as free-form text to avoid enum churn on later states.
--   • Create public.customer_activities — the notes/activity feed
--     parallel to public.lead_activities.
--   • RLS:
--       - SELECT: admin bypass + own-org via customers join.
--       - INSERT: own-org only (ghost mode for cross-org admins).
--
-- Idempotent: ADD COLUMN / CREATE TABLE / CREATE POLICY all
-- guarded by IF NOT EXISTS + DROP POLICY IF EXISTS.
-- ============================================================


-- ── 1. customers.status ─────────────────────────────────────────────────────

alter table public.customers
  add column if not exists status text not null default 'active';


-- ── 2. customer_activities table ────────────────────────────────────────────

create table if not exists public.customer_activities (
  id          uuid        primary key default gen_random_uuid(),
  customer_id uuid        not null references public.customers(id) on delete cascade,
  user_id     uuid        not null references auth.users(id),
  content     text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists customer_activities_customer_idx on public.customer_activities(customer_id);
create index if not exists customer_activities_created_idx  on public.customer_activities(created_at desc);

alter table public.customer_activities enable row level security;


-- ── 3. RLS policies ─────────────────────────────────────────────────────────

drop policy if exists "customer_activities: read"   on public.customer_activities;
drop policy if exists "customer_activities: insert" on public.customer_activities;

create policy "customer_activities: read"
  on public.customer_activities
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or customer_id in (
      select c.id
      from public.customers c
      where c.organization_id = public.auth_user_org_id()
    )
  );

create policy "customer_activities: insert"
  on public.customer_activities
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and customer_id in (
      select c.id
      from public.customers c
      where c.organization_id = public.auth_user_org_id()
    )
  );
