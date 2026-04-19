-- ============================================================
-- Migration: Admin HQ visibility — leads.
-- Extends the SELECT policy on public.leads so HQ admins
-- (is_admin_hq() = true) can read rows across organizations,
-- while regular members remain scoped to their own org.
--
-- Paired with the earlier 20260419141500_admin_visibility.sql
-- which did the same for organizations + tickets.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY.
--
-- NOTE: Only the SELECT policy is extended. INSERT / UPDATE /
-- DELETE policies still require `organization_id = auth_user_org_id()`
-- so HQ admins can *view* impersonated data but not mutate it.
-- Mutating another org's data should flow through explicit
-- admin RPCs (out of scope here).
-- ============================================================


drop policy if exists "leads: read own org"  on public.leads;
drop policy if exists "Admins can view all"  on public.leads;

create policy "Admins can view all"
  on public.leads
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );
