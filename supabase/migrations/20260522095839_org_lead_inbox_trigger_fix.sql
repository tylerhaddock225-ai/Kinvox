-- Fix: existing handle_new_user() trigger on auth.users INSERT already
-- auto-creates a public.profiles row using raw_user_meta_data->>'full_name'.
-- The previous ensure_organization_lead_inbox() function then tried to
-- INSERT a second profile with the same id → duplicate-key violation.
--
-- Corrected pattern: bake full_name into raw_user_meta_data so the
-- auto-created profile already has the display name, then UPDATE the
-- profile (rather than INSERT) to set organization_id + inbox flags.

CREATE OR REPLACE FUNCTION public.ensure_organization_lead_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_synthetic_email text;
BEGIN
  v_user_id := gen_random_uuid();
  v_synthetic_email := 'lead-inbox+' || NEW.slug || '@kinvox.internal';

  -- Create backing auth.users row. The on_auth_user_created trigger
  -- (handle_new_user) will auto-insert a profile row using full_name from
  -- raw_user_meta_data, so we bake "Lead Email" in here.
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
  SET organization_id = NEW.id,
      is_org_inbox = true,
      org_inbox_kind = 'lead',
      updated_at = now()
  WHERE id = v_user_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_organization_lead_inbox() IS
  'AFTER INSERT trigger on organizations. Creates backing auth.users row (handle_new_user auto-provisions the profile via full_name in raw_user_meta_data), then UPDATEs the profile with the org link + inbox flags. Synthetic email uses RFC 6761 reserved .internal TLD — never deliverable.';
