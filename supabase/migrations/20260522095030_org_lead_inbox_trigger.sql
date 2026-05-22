-- Function: provision a Lead Email pseudo-agent profile for a new org
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

  -- Create backing auth.users row (synthetic, never receives mail)
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_synthetic_email,
    crypt(gen_random_uuid()::text, gen_salt('bf')),
    now(),
    now(),
    now(),
    '{"provider":"system","providers":["system"]}'::jsonb,
    '{"is_org_inbox":true,"org_inbox_kind":"lead"}'::jsonb,
    false,
    '',
    '',
    '',
    ''
  );

  -- Create profile row with the inbox flags
  -- profiles uses only full_name (no first_name/last_name columns)
  INSERT INTO public.profiles (
    id,
    organization_id,
    full_name,
    is_org_inbox,
    org_inbox_kind,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    NEW.id,
    'Lead Email',
    true,
    'lead',
    now(),
    now()
  );

  RETURN NEW;
END;
$$;

-- Trigger: fires AFTER INSERT on organizations, sibling to existing credits provisioning
CREATE TRIGGER on_organization_created_provision_lead_inbox
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_organization_lead_inbox();

COMMENT ON FUNCTION public.ensure_organization_lead_inbox() IS
  'AFTER INSERT trigger on organizations. Creates backing auth.users row + Lead Email profile (is_org_inbox=true, org_inbox_kind=lead). Synthetic email uses RFC 6761 reserved .internal TLD — never deliverable.';
