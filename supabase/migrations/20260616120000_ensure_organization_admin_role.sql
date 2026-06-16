-- Workstream J Stage 1c — default "Org Admin" role per organization.
--
-- Every org should ship with a full-permission "Org Admin" role so HQ admins
-- can invite a tenant user and assign them complete org-admin rights
-- immediately — no manual role creation first. Provisioned via an AFTER INSERT
-- trigger on organizations (mirrors on_organization_created_provision_lead_inbox
-- from 20260522095839) and backfilled onto existing orgs in this same migration.
--
-- The role is marked is_system_role = true; app-level deletion protection lives
-- in settings/team/actions.ts deleteRole(). Permission edits stay allowed so a
-- later stage can backfill newly-added permission keys onto these rows.

BEGIN;

DROP TRIGGER IF EXISTS on_organization_created_provision_admin_role ON public.organizations;
DROP FUNCTION IF EXISTS public.ensure_organization_admin_role();

CREATE FUNCTION public.ensure_organization_admin_role()
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
      'view_leads',        true,
      'edit_leads',        true,
      'view_tickets',      true,
      'edit_tickets',      true,
      'view_appointments', true,
      'view_customers',    true,
      'edit_customers',    true,
      'view_analytics',    true,
      'manage_team',       true
    ),
    true
  )
  -- Idempotent against the partial unique index roles_tenant_name_unique
  -- (organization_id, name) WHERE organization_id IS NOT NULL. NEW.id is
  -- always non-null, so the index predicate always matches.
  ON CONFLICT (organization_id, name) WHERE organization_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_organization_admin_role() IS
  'AFTER INSERT trigger on organizations. Provisions a full-permission "Org Admin" tenant role (is_system_role=true) so HQ admins can grant complete org-admin rights at invite time. ON CONFLICT against roles_tenant_name_unique makes it idempotent; SECURITY DEFINER bypasses roles RLS.';

CREATE TRIGGER on_organization_created_provision_admin_role
AFTER INSERT ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.ensure_organization_admin_role();

-- Backfill: every existing org without an "Org Admin" role gets one. Catches
-- Niko's Storm Protection (currently zero roles) and any other legacy org.
INSERT INTO public.roles (organization_id, name, permissions, is_system_role)
SELECT
  o.id,
  'Org Admin',
  jsonb_build_object(
    'view_leads',        true,
    'edit_leads',        true,
    'view_tickets',      true,
    'edit_tickets',      true,
    'view_appointments', true,
    'view_customers',    true,
    'edit_customers',    true,
    'view_analytics',    true,
    'manage_team',       true
  ),
  true
FROM public.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles r
  WHERE r.organization_id = o.id AND r.name = 'Org Admin'
);

COMMIT;
