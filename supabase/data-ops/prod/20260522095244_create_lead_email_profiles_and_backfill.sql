-- Backfill Lead Email profile + auth.users row for every existing org
-- that doesn't already have one. Mirrors ensure_organization_lead_inbox()
-- trigger logic: handle_new_user() auto-creates the profile from raw_user_meta_data;
-- we then UPDATE it with organization_id + inbox flags.
--
-- Prod-adapted from sandbox version: the Niko-specific appointment
-- reassignment block was removed (sandbox-only fixup). The DO $$ loop
-- is universal and applies to every org on prod.
DO $$
DECLARE
  v_org record;
  v_user_id uuid;
  v_synthetic_email text;
  v_existing_profile_id uuid;
BEGIN
  FOR v_org IN
    SELECT id, slug, owner_id FROM public.organizations ORDER BY created_at
  LOOP
    -- Skip if org already has a Lead Email inbox profile
    SELECT id INTO v_existing_profile_id
    FROM public.profiles
    WHERE organization_id = v_org.id
      AND is_org_inbox = true
      AND org_inbox_kind = 'lead'
    LIMIT 1;

    IF v_existing_profile_id IS NOT NULL THEN
      RAISE NOTICE 'Skipping org % (%) — already has Lead Email profile %', v_org.slug, v_org.id, v_existing_profile_id;
      CONTINUE;
    END IF;

    v_user_id := gen_random_uuid();
    v_synthetic_email := 'lead-inbox+' || v_org.slug || '@kinvox.internal';

    -- Create backing auth.users row. handle_new_user() trigger auto-inserts
    -- the profile using full_name from raw_user_meta_data.
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      v_synthetic_email,
      crypt(gen_random_uuid()::text, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"system","providers":["system"]}'::jsonb,
      '{"is_org_inbox":true,"org_inbox_kind":"lead","full_name":"Lead Email"}'::jsonb,
      false, '', '', '', ''
    );

    -- handle_new_user just created the profile row. Update it with the
    -- organization context and inbox flags.
    UPDATE public.profiles
    SET organization_id = v_org.id,
        is_org_inbox = true,
        org_inbox_kind = 'lead',
        updated_at = now()
    WHERE id = v_user_id;

    RAISE NOTICE 'Created Lead Email profile % for org % (%)', v_user_id, v_org.slug, v_org.id;
  END LOOP;
END $$;

-- Verification (single SELECT — management API returns one row set per query)
SELECT metric, value FROM (
  SELECT 1 AS ord, 'Lead Email profiles count'::text AS metric,
         (SELECT COUNT(*) FROM public.profiles WHERE is_org_inbox = true AND org_inbox_kind = 'lead')::text AS value
  UNION ALL
  SELECT 2, 'Orgs without Lead Email',
         (SELECT COUNT(*) FROM public.organizations o
          WHERE NOT EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.organization_id = o.id
              AND p.is_org_inbox = true
              AND p.org_inbox_kind = 'lead'
          ))::text
) t ORDER BY ord;
