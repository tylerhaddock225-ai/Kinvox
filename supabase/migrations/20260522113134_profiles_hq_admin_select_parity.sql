-- HQ-admin parity policy for SELECT on public.profiles.
-- Mirrors the established convention used on leads, customers, tickets,
-- ticket_recipients, and lead_views (see manifest § Critical Memory Bank).
-- HQ admins impersonating a tenant org need to see that org's profiles
-- (e.g., the Lead Email pseudo-agent) in agent dropdowns. The existing
-- "profiles: select same org" policy is scoped by auth_user_org_id(),
-- which is not impersonation-aware — so it always evaluates against the
-- HQ admin's own org and strips tenant rows. This adds a third PERMISSIVE
-- SELECT policy that grants visibility to any caller with system_role set.
--
-- Kept narrow to is_admin_hq() alone (no organization_id clause) so it
-- composes cleanly with the existing org-scoped policy via OR.

CREATE POLICY "profiles: hq admin select parity"
  ON public.profiles
  FOR SELECT
  USING (is_admin_hq());
