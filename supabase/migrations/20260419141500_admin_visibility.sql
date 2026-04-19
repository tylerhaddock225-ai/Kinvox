-- ============================================================
-- Migration: Admin HQ visibility.
-- Extends SELECT policies on organizations + tickets so that
-- users with a non-null system_role (via public.is_admin_hq())
-- can read all rows, while preserving the existing org-scoped
-- access for regular members.
--
-- Run via `supabase db push` (use --include-all if CLI complains
-- about out-of-order timestamps — this file predates newer
-- applied migrations by design, matching the task brief).
--
-- Idempotent: each CREATE POLICY is preceded by DROP POLICY IF EXISTS.
-- ============================================================


-- ── 1. organizations ────────────────────────────────────────────────────────
--
-- Previous policy:
--   "organizations: select member or owner"
--   USING ((id = auth_user_org_id()) OR (owner_id = auth.uid()))

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


-- ── 2. tickets ──────────────────────────────────────────────────────────────
--
-- Previous policies (both org-scoped, redundant — consolidated here):
--   "Org members can view tickets"
--     USING (organization_id IN (SELECT organization_id FROM profiles
--                                WHERE id = auth.uid()))
--   "tickets: select own org"
--     USING (organization_id = auth_user_org_id())

drop policy if exists "Org members can view tickets" on public.tickets;
drop policy if exists "tickets: select own org"      on public.tickets;
drop policy if exists "Admins can view all"          on public.tickets;

create policy "Admins can view all"
  on public.tickets
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );
