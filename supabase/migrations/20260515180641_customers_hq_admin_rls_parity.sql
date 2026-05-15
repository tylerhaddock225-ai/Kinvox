-- Kinvox — HQ-admin RLS parity for the customers table.
--
-- Follow-up to 20260501000000_hq_admin_rls_parity.sql, which covered
-- leads / lead_messages / tickets / ticket_messages but missed customers.
-- Same impersonation gap: an HQ admin acting as a tenant org via
-- resolveEffectiveOrgId() writes against the tenant's organization_id,
-- but the existing org-member policies compare against the caller's
-- profiles.organization_id (which is the HQ org). Result: customers
-- INSERT/UPDATE/DELETE silently rejected by RLS.
--
-- Specifically: when a lead's status flips to 'converted',
-- mirrorLeadToCustomer (src/app/(app)/(dashboard)/actions/leads.ts)
-- tries to INSERT a row into customers. Under HQ-admin impersonation
-- this fails the WITH CHECK on "Org members can insert customers" and
-- the failure was previously swallowed via console.warn.
--
-- SELECT is already covered by the existing "Admins can view all"
-- policy (is_admin_hq() OR organization_id = auth_user_org_id()), so
-- only INSERT / UPDATE / DELETE need parity — matching the leads
-- precedent in 20260501000000.
--
-- Permissive policies OR with existing org-member policies; nothing
-- existing is touched. Idempotent via DROP POLICY IF EXISTS.

begin;

-- ── public.customers ──────────────────────────────────────────────────
drop policy if exists "customers: insert hq_admin" on public.customers;
create policy "customers: insert hq_admin"
  on public.customers
  for insert
  to authenticated
  with check ( public.is_admin_hq() );

drop policy if exists "customers: update hq_admin" on public.customers;
create policy "customers: update hq_admin"
  on public.customers
  for update
  to authenticated
  using      ( public.is_admin_hq() )
  with check ( public.is_admin_hq() );

drop policy if exists "customers: delete hq_admin" on public.customers;
create policy "customers: delete hq_admin"
  on public.customers
  for delete
  to authenticated
  using ( public.is_admin_hq() );

commit;
