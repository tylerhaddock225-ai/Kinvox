-- Workstream K Stage 1 — single HQ-global "HQ Admin" role with all 12 HQ keys.
--
-- HQ roles live in public.roles with organization_id IS NULL (no separate table).
-- This provisions one full-permission "HQ Admin" role so HQ staff can be granted
-- complete platform-admin rights via role_id. Guarded INSERT (WHERE NOT EXISTS)
-- avoids partial-unique-index ON CONFLICT complexity; the follow-up UPDATE keeps
-- the permissions bag in sync on every re-run.

BEGIN;

INSERT INTO public.roles (id, organization_id, name, is_system_role, permissions, created_at, updated_at)
SELECT
  gen_random_uuid(),
  NULL,
  'HQ Admin',
  true,
  jsonb_build_object(
    'manage_organizations',     true,
    'manage_org_integrations',  true,
    'send_claim_invites',       true,
    'approve_applications',     true,
    'manage_platform_tickets',  true,
    'manage_ai_templates',      true,
    'manage_platform_billing',  true,
    'manage_credits',           true,
    'manage_global_settings',   true,
    'manage_support_settings',  true,
    'manage_users',             true,
    'manage_global_roles',      true
  ),
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles WHERE organization_id IS NULL AND name = 'HQ Admin'
);

-- Idempotent re-sync of the permissions bag on re-runs.
UPDATE public.roles
SET permissions = jsonb_build_object(
      'manage_organizations',     true,
      'manage_org_integrations',  true,
      'send_claim_invites',       true,
      'approve_applications',     true,
      'manage_platform_tickets',  true,
      'manage_ai_templates',      true,
      'manage_platform_billing',  true,
      'manage_credits',           true,
      'manage_global_settings',   true,
      'manage_support_settings',  true,
      'manage_users',             true,
      'manage_global_roles',      true
    )
WHERE organization_id IS NULL AND name = 'HQ Admin';

COMMIT;
