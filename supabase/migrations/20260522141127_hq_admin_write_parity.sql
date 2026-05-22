-- HQ-admin write parity for tables that have SELECT HQ parity but no
-- INSERT/UPDATE/DELETE parity. Surfaced by Workstream F testing: after
-- createAppointment was correctly fixed to insert under the impersonated
-- tenant's org (rather than the HQ admin's own org), the existing
-- "Org members can insert appointments" policy rejected the row because
-- auth_user_org_id() returns the writer's actual org, not the impersonated
-- one. Same gap exists on customer_activities, organization_credentials,
-- and profiles.
--
-- Mirrors the established 3-policy pattern already in place on customers,
-- leads, and tickets. Each policy is bare is_admin_hq() — PERMISSIVE,
-- so it composes via OR with the existing org-scoped member policies.

-- ── appointments ──────────────────────────────────────────────────────
CREATE POLICY "appointments: insert hq_admin" ON public.appointments
  FOR INSERT WITH CHECK (is_admin_hq());

CREATE POLICY "appointments: update hq_admin" ON public.appointments
  FOR UPDATE USING (is_admin_hq()) WITH CHECK (is_admin_hq());

CREATE POLICY "appointments: delete hq_admin" ON public.appointments
  FOR DELETE USING (is_admin_hq());

-- ── customer_activities ───────────────────────────────────────────────
CREATE POLICY "customer_activities: insert hq_admin" ON public.customer_activities
  FOR INSERT WITH CHECK (is_admin_hq());

CREATE POLICY "customer_activities: update hq_admin" ON public.customer_activities
  FOR UPDATE USING (is_admin_hq()) WITH CHECK (is_admin_hq());

CREATE POLICY "customer_activities: delete hq_admin" ON public.customer_activities
  FOR DELETE USING (is_admin_hq());

-- ── organization_credentials ──────────────────────────────────────────
CREATE POLICY "organization_credentials: insert hq_admin" ON public.organization_credentials
  FOR INSERT WITH CHECK (is_admin_hq());

CREATE POLICY "organization_credentials: update hq_admin" ON public.organization_credentials
  FOR UPDATE USING (is_admin_hq()) WITH CHECK (is_admin_hq());

CREATE POLICY "organization_credentials: delete hq_admin" ON public.organization_credentials
  FOR DELETE USING (is_admin_hq());

-- ── profiles ──────────────────────────────────────────────────────────
-- Note: SELECT parity for profiles already added in 20260522113134
-- ("profiles: hq admin select parity"). This adds the write side.
CREATE POLICY "profiles: insert hq_admin" ON public.profiles
  FOR INSERT WITH CHECK (is_admin_hq());

CREATE POLICY "profiles: update hq_admin" ON public.profiles
  FOR UPDATE USING (is_admin_hq()) WITH CHECK (is_admin_hq());

CREATE POLICY "profiles: delete hq_admin" ON public.profiles
  FOR DELETE USING (is_admin_hq());
