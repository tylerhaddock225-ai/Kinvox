BEGIN;

-- M prod Stage 1 (decouple-only): null the HQ account's organization_id so it is no
-- longer dual-positive (HQ + tenant member). Kinvox Demo Org is intentionally retained
-- as a normal tenant org — unlike sandbox, prod's only org is populated and is NOT
-- deleted. This is the sole change M requires on prod data; the Stage 3 constraint
-- (Turn 3) needs dual_positive_count = 0 to validate.
UPDATE public.profiles
SET organization_id = NULL
WHERE id = '2ef26c2e-5695-4c46-99b3-547054f9494c'
  AND system_role = 'platform_owner';

-- Guard 1: exactly one row decoupled, and zero dual-positive remain.
DO $$
DECLARE dual_pos int; tyler_ok int;
BEGIN
  SELECT count(*) INTO dual_pos FROM public.profiles
  WHERE system_role IS NOT NULL AND organization_id IS NOT NULL;
  IF dual_pos <> 0 THEN
    RAISE EXCEPTION 'Dual-positive still present (%); aborting.', dual_pos;
  END IF;

  SELECT count(*) INTO tyler_ok FROM public.profiles
  WHERE id = '2ef26c2e-5695-4c46-99b3-547054f9494c'
    AND system_role = 'platform_owner' AND organization_id IS NULL;
  IF tyler_ok <> 1 THEN
    RAISE EXCEPTION 'Tyler HQ not decoupled as expected (%); aborting.', tyler_ok;
  END IF;
END $$;

-- Guard 2: Kinvox Demo Org still exists and is untouched (we did NOT delete it).
DO $$
DECLARE org_ok int;
BEGIN
  SELECT count(*) INTO org_ok FROM public.organizations
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF org_ok <> 1 THEN
    RAISE EXCEPTION 'Demo org missing — it must NOT be deleted (%); aborting.', org_ok;
  END IF;
END $$;

COMMIT;
