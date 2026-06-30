-- Workstream K2c Stage B — derive the Org Admin + HQ Admin permission bags from
-- permission_catalog (by scope), replacing the hand-maintained jsonb_build_object
-- snapshots from 20260616130001 (Org Admin) and 20260616130002 (HQ Admin).
--
-- Why: the two system-role bags were parallel hand-kept lists that happened to
-- equal the catalog. Any future scope='org'/'hq' catalog key had to be copied into
-- BOTH the trigger snapshot AND a re-sync UPDATE by hand, or the admin roles would
-- silently drift behind the catalog. Deriving the bag from permission_catalog makes
-- the catalog the single source of truth: new keys auto-include on org-create (via
-- the trigger) and on any re-run of the re-sync below.
--
-- Byte-compatible: the derived value is still {key: true} per key
-- (jsonb_object_agg(key, true)) — exactly the shape the runtime bagHas (=== true)
-- reads. For today's catalog (org=19, hq=12) the derivation yields the identical
-- key sets the snapshots already held, so this migration is a NO-OP on live bag
-- VALUES; it only changes the SOURCE OF TRUTH going forward.
--
-- Scope: touches ONLY the Org Admin trigger function and the Org Admin / HQ Admin
-- system-role rows (is_system_role = true). Custom roles and every non-admin role
-- are untouched. HQ Admin has no provisioning trigger (single seeded global row),
-- so the re-sync UPDATE below is its sole derivation path.

begin;

-- 1) Org Admin provisioning trigger function — build the bag from the org-scope
--    catalog instead of the 19-key hardcoded snapshot. EVERYTHING else is preserved
--    exactly as the live definition: SECURITY DEFINER, search_path = public, the
--    ON CONFLICT (organization_id, name) WHERE organization_id IS NOT NULL DO
--    NOTHING idempotency, and RETURN NEW. CREATE OR REPLACE keeps the existing
--    AFTER INSERT trigger (on_organization_created_provision_admin_role) attached —
--    the trigger is not rebound here.
create or replace function public.ensure_organization_admin_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.roles (organization_id, name, permissions, is_system_role)
  values (
    new.id,
    'Org Admin',
    -- Derived: every org-scope catalog key, granted. Auto-includes future keys.
    (select jsonb_object_agg(key, true) from public.permission_catalog where scope = 'org'),
    true
  )
  -- Idempotent against the partial unique index roles_tenant_name_unique
  -- (organization_id, name) WHERE organization_id IS NOT NULL.
  on conflict (organization_id, name) where organization_id is not null do nothing;

  return new;
end;
$$;

-- 2) Re-sync existing system-role rows so live data matches the new derivation.
--    Idempotent; for today's catalog these write the same 19 / 12 keys already
--    present (no-op on values). is_system_role = true guards custom roles.
update public.roles
   set permissions = (select jsonb_object_agg(key, true) from public.permission_catalog where scope = 'org')
 where name = 'Org Admin' and organization_id is not null and is_system_role = true;

update public.roles
   set permissions = (select jsonb_object_agg(key, true) from public.permission_catalog where scope = 'hq')
 where name = 'HQ Admin' and organization_id is null and is_system_role = true;

commit;
