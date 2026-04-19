-- ============================================================
-- Migration: Global admin visibility — SELECT only.
-- Extends SELECT policies on the remaining org-scoped core
-- tables so HQ admins (is_admin_hq() = true) can read rows
-- across organizations, while regular members stay scoped to
-- their own org.
--
-- Tables covered:
--   • customers
--   • appointments
--   • lead_activities   (scoped via leads.organization_id)
--   • ticket_messages   (column is org_id, legacy naming)
--   • organizations     (re-applied idempotently for completeness)
--
-- READ-ONLY by design: INSERT / UPDATE / DELETE policies are
-- intentionally left untouched — admins are "ghosts" who look
-- but don't touch. Cross-org mutations must flow through
-- explicit admin RPCs (not introduced here).
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY for
-- every target.
-- ============================================================


-- ── 1. customers ────────────────────────────────────────────────────────────

drop policy if exists "Org members can view customers" on public.customers;
drop policy if exists "Admins can view all"             on public.customers;

create policy "Admins can view all"
  on public.customers
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );


-- ── 2. appointments ─────────────────────────────────────────────────────────

drop policy if exists "Org members can view appointments" on public.appointments;
drop policy if exists "Admins can view all"                on public.appointments;

create policy "Admins can view all"
  on public.appointments
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );


-- ── 3. lead_activities ──────────────────────────────────────────────────────
--
-- No direct organization_id column — scoped through the parent lead.
-- Preserve the join, add admin bypass at the top level.

drop policy if exists "Org members can view lead activities" on public.lead_activities;
drop policy if exists "Admins can view all"                   on public.lead_activities;

create policy "Admins can view all"
  on public.lead_activities
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or lead_id in (
      select l.id
      from public.leads l
      where l.organization_id = public.auth_user_org_id()
    )
  );


-- ── 4. ticket_messages ──────────────────────────────────────────────────────
--
-- Column is 'org_id' (not organization_id) — legacy naming preserved.

drop policy if exists "Org members can view ticket messages" on public.ticket_messages;
drop policy if exists "Admins can view all"                   on public.ticket_messages;

create policy "Admins can view all"
  on public.ticket_messages
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or org_id = public.auth_user_org_id()
  );


-- ── 5. organizations (re-applied for auditability) ──────────────────────────
--
-- Already set by 20260419141500_admin_visibility.sql — re-declared
-- here so this migration is a single self-contained manifest of
-- every table in the admin-visibility perimeter.

drop policy if exists "organizations: select member or owner" on public.organizations;
drop policy if exists "Admins can view all"                   on public.organizations;

create policy "Admins can view all"
  on public.organizations
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or id = public.auth_user_org_id()
    or owner_id = auth.uid()
  );
