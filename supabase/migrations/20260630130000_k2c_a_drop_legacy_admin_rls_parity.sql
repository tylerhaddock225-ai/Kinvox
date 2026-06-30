-- Workstream K2c Stage A — drop the legacy auth_user_role() = 'admin' OR-branch
-- from the two K4 write-parity policies, now that every tenant admin holds a
-- permission-bag role (Org Admin) granting the equivalent key. The bag path
-- auth_user_has_permission(...) becomes the sole tenant-admin predicate;
-- is_admin_hq() (HQ impersonation) is preserved on organizations.
--
-- SCOPED — these are the ONLY two policies that gained permission-bag parity (K4,
-- 20260619120000), so they are the only ones safe to strip. The other legacy
-- role='admin' RLS sites have NO bag alternative and are INTENTIONALLY LEFT
-- UNTOUCHED here (stripping them would lock out bag-only admins). Deferred to a
-- future parity stage:
--   * leads        — "leads: delete admin only"        (DELETE)
--   * tickets      — "tickets: delete admin only" + "Admins can delete tickets" (DELETE)
--   * appointments — "Admins can delete appointments"  (DELETE)
--   * customers    — "Admins can delete customers"     (DELETE)
--   * member_invitations — 5 tenant-admin policies (select/insert/update/delete; app uses service-role)
--
-- Each policy below is recreated exactly as K4 defined it (FOR ALL / FOR UPDATE,
-- role public, permissive) minus the `auth_user_role() = 'admin' OR` disjunct.

begin;

-- roles: tenant-role management — permission-bag only now.
drop policy if exists "Tenant admins manage tenant roles" on public.roles;
create policy "Tenant admins manage tenant roles"
on public.roles
for all
using (
  (organization_id is not null)
  and (organization_id = auth_user_org_id())
  and auth_user_has_permission('manage_roles')
)
with check (
  (organization_id is not null)
  and (organization_id = auth_user_org_id())
  and auth_user_has_permission('manage_roles')
);

-- organizations: tenant update branch — permission-bag only; HQ impersonation
-- (is_admin_hq) preserved.
drop policy if exists "Admins can update organizations" on public.organizations;
create policy "Admins can update organizations"
on public.organizations
for update
using (
  is_admin_hq()
  or ((id = auth_user_org_id()) and auth_user_has_permission('manage_org_settings'))
)
with check (
  is_admin_hq()
  or ((id = auth_user_org_id()) and auth_user_has_permission('manage_org_settings'))
);

commit;
