-- Workstream K4: RLS write parity for permission-bag authorization.
-- Adds auth_user_has_permission(text) and OR-branches it into the two tenant
-- write policies that still key solely on legacy auth_user_role()='admin'.
-- Additive: legacy admin predicate retained (back-compat for K2c cleanup later).

-- 1) Permission-bag helper (collision-checked: did not previously exist)
create or replace function public.auth_user_has_permission(perm_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and r.permissions @> jsonb_build_object(perm_key, true)
  );
$$;

grant execute on function public.auth_user_has_permission(text) to authenticated;

-- 2) roles: tenant-admin write policy (the K3 reproducer) — add OR manage_roles
drop policy if exists "Tenant admins manage tenant roles" on public.roles;
create policy "Tenant admins manage tenant roles"
on public.roles
for all
using (
  (organization_id is not null)
  and (organization_id = auth_user_org_id())
  and (auth_user_role() = 'admin' or auth_user_has_permission('manage_roles'))
)
with check (
  (organization_id is not null)
  and (organization_id = auth_user_org_id())
  and (auth_user_role() = 'admin' or auth_user_has_permission('manage_roles'))
);

-- 3) organizations: tenant update branch — add OR manage_org_settings
drop policy if exists "Admins can update organizations" on public.organizations;
create policy "Admins can update organizations"
on public.organizations
for update
using (
  is_admin_hq()
  or ((id = auth_user_org_id())
      and (auth_user_role() = 'admin' or auth_user_has_permission('manage_org_settings')))
)
with check (
  is_admin_hq()
  or ((id = auth_user_org_id())
      and (auth_user_role() = 'admin' or auth_user_has_permission('manage_org_settings')))
);
