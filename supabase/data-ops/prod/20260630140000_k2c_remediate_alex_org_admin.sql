-- K2c prod prerequisite (Stage A): remediate the one fallback-dependent prod user
-- BEFORE the Stage A RLS migration removes the role='admin' back-compat.
--
-- Alex Admin (bbbbbbbb-…-001, admin@kinvox-demo.com) is the owner_id of Kinvox Demo
-- Org and cannot be deleted (organizations.owner_id is NOT NULL, FK NO ACTION). He
-- currently authorizes ONLY via the role='admin' fallback (role_id NULL). Assigning
-- him the demo org's existing system "Org Admin" role (ddaff626…, full 19-key bag)
-- moves him onto the permission-bag path, so removing the fallback can't lock him
-- out. Non-destructive: owner_id untouched, Sam untouched, no other rows touched.

BEGIN;

-- Pre-guard: the target role must be the demo org's Org Admin AND carry
-- manage_org_settings — otherwise the remediation wouldn't actually unblock Alex.
DO $$
DECLARE role_ok int;
BEGIN
  SELECT count(*) INTO role_ok FROM public.roles
  WHERE id = 'ddaff626-0145-486b-b6f1-3ca40282805e'
    AND organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND coalesce((permissions->>'manage_org_settings')::boolean, false) = true;
  IF role_ok <> 1 THEN
    RAISE EXCEPTION 'Target Org Admin role ddaff626 check failed (matched % rows); aborting.', role_ok;
  END IF;
END $$;

-- Remediate Alex. Scoped to Alex + his org; role_id IS NULL keeps the UPDATE from
-- overwriting an already-assigned role. GET DIAGNOSTICS asserts this run touched
-- exactly his one row.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.profiles
  SET role_id = 'ddaff626-0145-486b-b6f1-3ca40282805e'
  WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
    AND organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    AND role_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected to update exactly 1 row (Alex, role_id NULL); updated % — aborting.', n;
  END IF;
END $$;

-- Post-guard: Alex now holds the role, AND zero fallback-dependent tenant admins
-- remain (the invariant Stage A's RLS removal needs). This is the same lockout
-- query from Phase 1.
DO $$
DECLARE alex_ok int; fallback_users int;
BEGIN
  SELECT count(*) INTO alex_ok FROM public.profiles
  WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'
    AND role_id = 'ddaff626-0145-486b-b6f1-3ca40282805e';
  IF alex_ok <> 1 THEN
    RAISE EXCEPTION 'Alex role_id not set as expected (%); aborting.', alex_ok;
  END IF;

  SELECT count(*) INTO fallback_users FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE p.role = 'admin' AND p.system_role IS NULL
    AND (p.role_id IS NULL OR coalesce((r.permissions->>'manage_org_settings')::boolean, false) = false);
  IF fallback_users <> 0 THEN
    RAISE EXCEPTION 'Fallback-dependent users still present (%); aborting before Stage A.', fallback_users;
  END IF;
END $$;

COMMIT;
