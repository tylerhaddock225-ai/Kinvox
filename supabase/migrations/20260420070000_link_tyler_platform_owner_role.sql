-- ============================================================
-- Migration: Link tyler@kinvoxtech.com to the HQ "Platform Owner"
-- role and make sure the role's permissions bag carries every
-- HQ-wide Super Admin bit.
--
-- Why
--   The new HQ Roles UI gates on profile.role.permissions via
--   hasHqPermission(). Tyler's system_role is platform_owner but
--   his role_id was never populated, so the helper was returning
--   false for every HQ key. Two fixes in one migration:
--     1. Ensure the seeded Platform Owner role has the full
--        superuser permission bag, including manage_global_roles
--        and manage_global_settings.
--     2. Point profiles.role_id at that role for Tyler's profile.
--   The Super Admin *bypass* added to src/lib/permissions.ts is
--   what protects against future gaps, but pointing role_id here
--   keeps `role:roles(permissions)` joins meaningful.
--
-- Idempotent: jsonb || overlay, UPDATE with WHERE id=..., guarded
-- NOTICEs so `supabase db push` output makes the outcome obvious.
-- ============================================================


-- ── 1. Upgrade Platform Owner role permissions ─────────────
update public.roles
   set permissions = coalesce(permissions, '{}'::jsonb)
                  || jsonb_build_object(
                       'manage_users',             true,
                       'manage_global_roles',      true,
                       'manage_platform_billing',  true,
                       'manage_support_settings',  true,
                       'manage_global_settings',   true
                     )
 where organization_id is null
   and name = 'Platform Owner';


-- ── 2. Link Tyler's profile to the Platform Owner role ─────
-- The BEFORE trigger enforce_profile_role_scope accepts this:
-- Tyler has system_role = 'platform_owner' (HQ staff), and the
-- Platform Owner role has organization_id IS NULL. Matches the
-- HQ branch of the scope check, does not fire the tenant branch.

update public.profiles as p
   set role_id = r.id
  from public.roles as r
  join auth.users  as u on lower(u.email) = 'tyler@kinvoxtech.com'
 where r.organization_id is null
   and r.name = 'Platform Owner'
   and p.id  = u.id;


-- ── 3. Verification ────────────────────────────────────────
do $$
declare
  v_role_hit     integer;
  v_profile_hit  integer;
  v_perms_ok     boolean;
begin
  select count(*) into v_role_hit
    from public.roles
   where organization_id is null
     and name = 'Platform Owner'
     and (permissions ->> 'manage_global_roles')::boolean    is true
     and (permissions ->> 'manage_global_settings')::boolean is true;

  select count(*) into v_profile_hit
    from public.profiles p
    join auth.users      u on u.id = p.id
    join public.roles    r on r.id = p.role_id
   where lower(u.email)     = 'tyler@kinvoxtech.com'
     and r.organization_id is null
     and r.name             = 'Platform Owner';

  v_perms_ok := (v_role_hit = 1);

  if not v_perms_ok then
    raise notice '⚠ Platform Owner role is missing one of the required permission bits.';
  else
    raise notice '✓ Platform Owner role has manage_global_roles + manage_global_settings.';
  end if;

  if v_profile_hit = 0 then
    raise notice '⚠ Tyler profile NOT linked to Platform Owner role. Check auth.users email casing and that the profile row exists.';
  else
    raise notice '✓ tyler@kinvoxtech.com -> Platform Owner role (profile.role_id updated).';
  end if;
end $$;
