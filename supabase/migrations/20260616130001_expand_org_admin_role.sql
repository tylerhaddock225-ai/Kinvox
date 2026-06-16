-- Workstream K Stage 1 — expand the "Org Admin" role to the full 19-key catalog.
--
-- Stage 1c (20260616120000) provisioned a 9-key "Org Admin" per org. K Stage 1
-- expands ORG_PERMISSION_KEYS to 19, so the provisioning trigger's bag and every
-- existing Org Admin row must be re-synced to all 19 keys = true. CREATE OR
-- REPLACE preserves the existing on_organization_created_provision_admin_role
-- trigger (it references this function by name).

BEGIN;

CREATE OR REPLACE FUNCTION public.ensure_organization_admin_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.roles (organization_id, name, permissions, is_system_role)
  VALUES (
    NEW.id,
    'Org Admin',
    jsonb_build_object(
      'view_leads',                  true,
      'edit_leads',                  true,
      'view_tickets',                true,
      'edit_tickets',                true,
      'view_appointments',           true,
      'edit_appointments',           true,
      'view_customers',              true,
      'edit_customers',              true,
      'view_signals',                true,
      'manage_signals',              true,
      'edit_signal_settings',        true,
      'manage_social_connections',   true,
      'manage_lead_settings',        true,
      'manage_org_support_settings', true,
      'manage_org_settings',         true,
      'manage_billing',              true,
      'manage_team',                 true,
      'manage_roles',                true,
      'view_analytics',              true
    ),
    true
  )
  -- Idempotent against the partial unique index roles_tenant_name_unique
  -- (organization_id, name) WHERE organization_id IS NOT NULL.
  ON CONFLICT (organization_id, name) WHERE organization_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

-- Re-sync every existing Org Admin row to the full 19-key bag.
UPDATE public.roles
SET permissions = jsonb_build_object(
      'view_leads',                  true,
      'edit_leads',                  true,
      'view_tickets',                true,
      'edit_tickets',                true,
      'view_appointments',           true,
      'edit_appointments',           true,
      'view_customers',              true,
      'edit_customers',              true,
      'view_signals',                true,
      'manage_signals',              true,
      'edit_signal_settings',        true,
      'manage_social_connections',   true,
      'manage_lead_settings',        true,
      'manage_org_support_settings', true,
      'manage_org_settings',         true,
      'manage_billing',              true,
      'manage_team',                 true,
      'manage_roles',                true,
      'view_analytics',              true
    )
WHERE name = 'Org Admin' AND is_system_role = true;

COMMIT;
