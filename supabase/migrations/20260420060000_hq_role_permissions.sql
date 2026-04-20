-- ============================================================
-- Migration: Unify the roles table across HQ + tenant scopes.
--
-- Before
--   public.roles.organization_id is NOT NULL — every role is
--   owned by exactly one org.
--
-- After
--   organization_id becomes NULLABLE. A role with organization_id
--   IS NULL is a GLOBAL HQ ROLE, assignable only to HQ staff
--   (profiles with system_role IS NOT NULL). Tenant roles keep
--   organization_id NOT NULL behaviour via a CHECK partition.
--
-- Why
--   Single source of truth for permission bundles: HQ-side UI at
--   /admin-hq/settings/roles creates NULL-org roles; tenant admins
--   at /settings/team keep CRUDing their org-scoped roles.
--   profile.role_id always points at this table.
-- ============================================================


-- ── 1. Allow organization_id to be null ─────────────────────
alter table public.roles
  alter column organization_id drop not null;


-- ── 2. Reset the unique index so (NULL, name) coexists ──────
-- The historical UNIQUE (organization_id, name) was declared
-- inline in the CREATE TABLE, so it lives as a CONSTRAINT that
-- owns its backing index. We drop the constraint first (which
-- auto-drops the index) then recreate as two partial uniques:
--   a) tenant roles: unique per (org_id, name)
--   b) HQ roles:     unique on (name) where org_id IS NULL
--
-- Must be DROP CONSTRAINT before DROP INDEX — the reverse order
-- fails with SQLSTATE 2BP01 because the constraint still depends
-- on the index at that point.

alter table public.roles drop constraint if exists roles_organization_id_name_key;
drop index    if exists public.roles_organization_id_name_key;

create unique index if not exists roles_tenant_name_unique
  on public.roles(organization_id, name)
  where organization_id is not null;

create unique index if not exists roles_hq_name_unique
  on public.roles(name)
  where organization_id is null;


-- ── 3. Tighten RLS so each side can only manage its own ─────
alter table public.roles enable row level security;

drop policy if exists "Org members can view roles"   on public.roles;
drop policy if exists "Admins can manage roles"      on public.roles;
drop policy if exists "HQ staff can view HQ roles"   on public.roles;
drop policy if exists "HQ staff can manage HQ roles" on public.roles;

-- SELECT ─────────────────────────────────────────────────────
-- Tenant members see their org's roles.
create policy "Org members can view tenant roles"
  on public.roles for select
  using (
    organization_id is not null
    and organization_id = public.auth_user_org_id()
  );

-- HQ staff see every HQ role AND every tenant role (mirrors
-- the cross-tenant visibility established in 20260419193640).
create policy "HQ staff can view all roles"
  on public.roles for select
  using (public.is_admin_hq());


-- INSERT / UPDATE / DELETE ──────────────────────────────────
-- Tenant admins manage their own org's roles.
create policy "Tenant admins manage tenant roles"
  on public.roles for all
  using (
    organization_id is not null
    and organization_id = public.auth_user_org_id()
    and public.auth_user_role() = 'admin'
  )
  with check (
    organization_id is not null
    and organization_id = public.auth_user_org_id()
    and public.auth_user_role() = 'admin'
  );

-- HQ staff manage HQ-global roles (organization_id IS NULL).
create policy "HQ staff manage HQ roles"
  on public.roles for all
  using (
    organization_id is null
    and public.is_admin_hq()
  )
  with check (
    organization_id is null
    and public.is_admin_hq()
  );


-- ── 4. Safety constraint: profile role_id scope integrity ───
-- A tenant member (system_role IS NULL) cannot point role_id at
-- an HQ-global role, and vice-versa. Enforced by a BEFORE trigger
-- since PostgreSQL CHECK constraints can't reference another table.
create or replace function public.enforce_profile_role_scope()
returns trigger
language plpgsql
as $$
declare
  v_role_org uuid;
begin
  if new.role_id is null then
    return new;
  end if;

  select organization_id into v_role_org
    from public.roles where id = new.role_id;

  -- HQ staff: role must be HQ-global (NULL org).
  if new.system_role is not null and v_role_org is not null then
    raise exception 'HQ staff (system_role=%) cannot be assigned a tenant-scoped role', new.system_role;
  end if;

  -- Tenant member: role must match their own org.
  if new.system_role is null and v_role_org is null then
    raise exception 'Tenant member cannot be assigned an HQ-global role';
  end if;

  if new.system_role is null
     and v_role_org is not null
     and v_role_org is distinct from new.organization_id then
    raise exception 'Role % belongs to a different organization than profile %', new.role_id, new.id;
  end if;

  return new;
end
$$;

drop trigger if exists enforce_profile_role_scope on public.profiles;
create trigger enforce_profile_role_scope
  before insert or update of role_id, system_role, organization_id
  on public.profiles
  for each row execute function public.enforce_profile_role_scope();


-- ── 5. Seed a minimal HQ role set ───────────────────────────
-- Idempotent: ON CONFLICT on the HQ partial unique index. The
-- HQ pages treat missing seeds gracefully, but surfacing these
-- out of the box makes the UI feel populated on first load.

insert into public.roles (organization_id, name, permissions, is_system_role)
values
  (null, 'Platform Owner',      '{"manage_users": true,  "manage_global_roles": true,  "manage_platform_billing": true,  "manage_support_settings": true}'::jsonb,  true),
  (null, 'Platform Admin',      '{"manage_users": true,  "manage_global_roles": true,  "manage_platform_billing": false, "manage_support_settings": true}'::jsonb,  true),
  (null, 'Platform Support',    '{"manage_users": false, "manage_global_roles": false, "manage_platform_billing": false, "manage_support_settings": true}'::jsonb,  true),
  (null, 'Platform Sales',      '{"manage_users": false, "manage_global_roles": false, "manage_platform_billing": false, "manage_support_settings": false}'::jsonb, true),
  (null, 'Platform Accounting', '{"manage_users": false, "manage_global_roles": false, "manage_platform_billing": true,  "manage_support_settings": false}'::jsonb, true)
on conflict do nothing;
