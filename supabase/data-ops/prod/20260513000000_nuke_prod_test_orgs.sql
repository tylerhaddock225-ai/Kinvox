-- One-time production cleanup: hard-delete 4 legacy test orgs (org_2..org_5).
-- KEEP org_1 (Kinvox Demo Org, aaaaaaaa-0000-0000-0000-000000000001) intact.
--
-- Audit (PRODUCTION ref jysnvuqdrfejejosizwo, 2026-05-13) confirmed:
--   - All 17 FKs pointing at organizations are CASCADE or SET NULL (no RESTRICT/NO ACTION)
--   - Target orgs have 0 related rows in every dependent table EXCEPT organization_credits (1 row each)
--   - No profiles or roles are scoped to the target orgs (all 3 profiles + 5 platform roles live elsewhere)
--   - Tyler's profile (system_role=platform_owner) is scoped to org_1 and is not touched
--
-- The DO block runs the deletes and three guard checks. Any failed check RAISEs and
-- the entire migration transaction is rolled back by Supabase's migration runner.

DO $$
DECLARE
  v_org_count        integer;
  v_remaining_org_id uuid;
  v_stray_credits    integer;
BEGIN
  -- Defensive explicit child wipe (the parent DELETE cascades to organization_credits via
  -- ON DELETE CASCADE, but doing it explicitly first makes the intent auditable).
  DELETE FROM public.organization_credits
  WHERE organization_id IN (
    'c25f686a-dcce-4222-9fde-8171b4cc8ccb', -- Kinvox HQ
    '5abad1e5-8ad5-41dd-8edd-ce1b402c6113', -- Kinvox Test
    'ffb91433-d5e5-4823-ab1f-b57770ffbcb1', -- Dooku's Empire
    '3f7ce86c-d081-4f9b-b870-9b7a691adffe'  -- Echo's Play House
  );

  -- Parent delete; CASCADE / SET NULL handle every other dependent table.
  DELETE FROM public.organizations
  WHERE id IN (
    'c25f686a-dcce-4222-9fde-8171b4cc8ccb',
    '5abad1e5-8ad5-41dd-8edd-ce1b402c6113',
    'ffb91433-d5e5-4823-ab1f-b57770ffbcb1',
    '3f7ce86c-d081-4f9b-b870-9b7a691adffe'
  );

  -- Verification (a): exactly 1 org remains.
  SELECT count(*) INTO v_org_count FROM public.organizations;
  IF v_org_count <> 1 THEN
    RAISE EXCEPTION
      'Verification (a) failed: expected exactly 1 organization remaining, found %',
      v_org_count;
  END IF;

  -- Verification (b): remaining org is Kinvox Demo Org (org_1).
  SELECT id INTO v_remaining_org_id FROM public.organizations;
  IF v_remaining_org_id <> 'aaaaaaaa-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION
      'Verification (b) failed: remaining org id is %, expected aaaaaaaa-0000-0000-0000-000000000001',
      v_remaining_org_id;
  END IF;

  -- Verification (c): no organization_credits rows remain for any non-org_1 org.
  SELECT count(*) INTO v_stray_credits
  FROM public.organization_credits
  WHERE organization_id <> 'aaaaaaaa-0000-0000-0000-000000000001'::uuid;
  IF v_stray_credits <> 0 THEN
    RAISE EXCEPTION
      'Verification (c) failed: % organization_credits row(s) still reference non-org_1 orgs',
      v_stray_credits;
  END IF;

  RAISE NOTICE 'nuke_prod_test_orgs: all 3 verifications passed (orgs=%, kept_id=%, stray_credits=%)',
    v_org_count, v_remaining_org_id, v_stray_credits;
END $$;
