BEGIN;

-- M Stage 1a: decouple Tyler HQ (platform_owner) from the dead-weight org.
-- MUST happen before the org delete, or ON DELETE CASCADE removes this profile.
UPDATE public.profiles
SET organization_id = NULL
WHERE id = '7205089d-a09c-4e89-9e64-9d172d7e37dd'
  AND system_role = 'platform_owner';

-- Guard: confirm exactly one row was decoupled and zero dual-positive remain.
DO $$
DECLARE dual_pos int;
BEGIN
  SELECT count(*) INTO dual_pos FROM public.profiles
  WHERE system_role IS NOT NULL AND organization_id IS NOT NULL;
  IF dual_pos <> 0 THEN
    RAISE EXCEPTION 'Dual-positive profiles still present (%); aborting.', dual_pos;
  END IF;
END $$;

-- M Stage 1b: delete the orphaned lead-inbox bot auth.users row.
-- The org delete cascade-removes the bot's profiles row but leaves this
-- synthetic auth.users row behind as litter. Remove it explicitly.
DELETE FROM auth.users
WHERE id = '628ea641-1946-4bbf-bfa7-2e3238ac1abb'
  AND email = 'lead-inbox+kinvox-sandbox-hq@kinvox.internal';

-- M Stage 1c: delete the dead-weight org. Cascade removes its remaining
-- children (bot profile, 2 roles, 2 tickets, 3 appointments, 12 pending_signals,
-- 1 organization_credits). All confirmed disposable test data.
DELETE FROM public.organizations
WHERE id = '5d3f6e08-4e48-4913-a429-350a0875fe9d'
  AND slug = 'kinvox-sandbox-hq';

-- Final guards: org gone, Tyler HQ profile intact + decoupled.
DO $$
DECLARE org_ct int; tyler_ct int;
BEGIN
  SELECT count(*) INTO org_ct FROM public.organizations
  WHERE id = '5d3f6e08-4e48-4913-a429-350a0875fe9d';
  IF org_ct <> 0 THEN RAISE EXCEPTION 'Org not deleted; aborting.'; END IF;

  SELECT count(*) INTO tyler_ct FROM public.profiles
  WHERE id = '7205089d-a09c-4e89-9e64-9d172d7e37dd'
    AND system_role = 'platform_owner' AND organization_id IS NULL;
  IF tyler_ct <> 1 THEN
    RAISE EXCEPTION 'Tyler HQ profile missing or not decoupled (%); aborting.', tyler_ct;
  END IF;
END $$;

COMMIT;
