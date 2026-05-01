-- Kinvox — HQ-admin RLS parity for the leads / tickets domain.
--
-- Closes the impersonation gap where an HQ admin (profiles.system_role IS
-- NOT NULL → public.is_admin_hq() = true) writes against a tenant org
-- they're "acting as" via resolveEffectiveOrgId(). The existing
-- org-member policies on these tables compare organization_id against the
-- caller's profiles.organization_id, which is the HQ org — not the
-- impersonated tenant org — so every INSERT/UPDATE/DELETE rejected with
-- "new row violates row-level security policy".
--
-- ticket_messages already had this branch (HQ admins can insert ticket
-- messages); leads, lead_messages, tickets had partial parity (SELECT and
-- tickets UPDATE only). This migration adds permissive HQ-admin policies
-- covering every command where impersonation could write. Permissive
-- policies OR together with existing org-member policies — nothing
-- existing is touched.
--
-- Idempotent: every CREATE POLICY is preceded by DROP POLICY IF EXISTS,
-- so this is safe to re-run.

-- ── public.leads ──────────────────────────────────────────────────────
drop policy if exists "leads: insert hq_admin" on public.leads;
create policy "leads: insert hq_admin"
  on public.leads
  for insert
  to authenticated
  with check ( public.is_admin_hq() );

drop policy if exists "leads: update hq_admin" on public.leads;
create policy "leads: update hq_admin"
  on public.leads
  for update
  to authenticated
  using      ( public.is_admin_hq() )
  with check ( public.is_admin_hq() );

drop policy if exists "leads: delete hq_admin" on public.leads;
create policy "leads: delete hq_admin"
  on public.leads
  for delete
  to authenticated
  using ( public.is_admin_hq() );


-- ── public.lead_messages ──────────────────────────────────────────────
-- INSERT mirrors the existing org-user policy's author invariants
-- (author_kind + author_user_id) so HQ admins can't mint messages
-- attributed to other users via this branch.
drop policy if exists "lead_messages: insert hq_admin" on public.lead_messages;
create policy "lead_messages: insert hq_admin"
  on public.lead_messages
  for insert
  to authenticated
  with check (
    public.is_admin_hq()
    and author_kind    = 'org_user'
    and author_user_id = auth.uid()
  );

drop policy if exists "lead_messages: delete hq_admin" on public.lead_messages;
create policy "lead_messages: delete hq_admin"
  on public.lead_messages
  for delete
  to authenticated
  using ( public.is_admin_hq() );


-- ── public.tickets ────────────────────────────────────────────────────
drop policy if exists "tickets: insert hq_admin" on public.tickets;
create policy "tickets: insert hq_admin"
  on public.tickets
  for insert
  to authenticated
  with check ( public.is_admin_hq() );

drop policy if exists "tickets: delete hq_admin" on public.tickets;
create policy "tickets: delete hq_admin"
  on public.tickets
  for delete
  to authenticated
  using ( public.is_admin_hq() );


-- ── public.ticket_messages ────────────────────────────────────────────
-- INSERT for HQ admins already exists ("HQ admins can insert ticket
-- messages") in the baseline schema. Only DELETE parity is added here —
-- existing "Authors can delete their own ticket messages" only allows
-- self-authored deletes, so an HQ admin couldn't clean up a message
-- written under a different session.
drop policy if exists "ticket_messages: delete hq_admin" on public.ticket_messages;
create policy "ticket_messages: delete hq_admin"
  on public.ticket_messages
  for delete
  to authenticated
  using ( public.is_admin_hq() );
