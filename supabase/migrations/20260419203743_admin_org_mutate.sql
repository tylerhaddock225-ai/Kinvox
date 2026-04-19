-- ============================================================
-- Migration: HQ admin can mutate organizations.
-- Extends the UPDATE policy on public.organizations to allow
-- is_admin_hq() in addition to the existing "org's own admin"
-- branch. Covers:
--   • Status toggle (active / inactive)
--   • Editing name, vertical, plan
--   • Archiving via deleted_at (soft delete through UPDATE)
--
-- Other tables intentionally remain "ghost mode" (admins can
-- SELECT across orgs but cannot write). If cross-org mutation
-- becomes needed on more tables, extend each policy explicitly.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY.
-- ============================================================

drop policy if exists "organizations: update if admin" on public.organizations;
drop policy if exists "Admins can update organizations" on public.organizations;

create policy "Admins can update organizations"
  on public.organizations
  for update
  to authenticated
  using (
    public.is_admin_hq()
    or (
      id = public.auth_user_org_id()
      and public.auth_user_role() = 'admin'
    )
  )
  with check (
    public.is_admin_hq()
    or (
      id = public.auth_user_org_id()
      and public.auth_user_role() = 'admin'
    )
  );
