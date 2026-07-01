-- Workstream K2c Stage 6a — RLS parity: retire the legacy role='admin' predicate
-- from the 9 remaining tenant-admin policies, retrofitting them onto the
-- permission-bag helper auth_user_has_permission(<key>). This cuts the last RLS
-- readers of profiles.role, so the text column becomes authority-dead. Its
-- eventual drop — plus dropping auth_user_role()/get_user_role() and the redeem
-- role='admin' write — is a LATER deprecation chain, NOT touched here.
--
-- member_invitations (4 policies) map onto the existing 'manage_team' key — the
-- same key inviteMember/removeMember already gate on. The 4 record-DELETE
-- policies map onto NEW delete_<resource> catalog keys (Option B): this
-- preserves the honest "tenant admin only may delete" semantics rather than
-- widening deletion to every edit_* holder (edit_* defaults true for custom
-- roles). The new keys flow into the Org Admin bag via the K2c-B catalog-derived
-- re-sync (reused verbatim below), so existing Org Admins (e.g. prod's Alex)
-- keep delete access after the swap.
--
-- HQ is_admin_hq() parity policies are COMPLETE and LEFT UNTOUCHED — they OR
-- alongside the tenant policies. This migration only DROP/CREATEs the 9
-- tenant-admin (role='admin') policies, adds 4 catalog keys, and re-syncs bags.

begin;

-- ── STEP 1: add the 4 delete_* org-scope catalog keys ───────────────────────
-- Matches the existing row shape + per-resource group_slug/group_label. The
-- action_tier='delete' / sort_order=40 follows the catalog's documented
-- convention (view=10, edit=20, manage=30, delete=40). Idempotent upsert,
-- mirroring the seed migration (20260616130000).
insert into public.permission_catalog
  (key, scope, group_slug, group_label, permission_label, description, action_tier, sort_order)
values
  ('delete_leads',        'org', 'leads',        'Leads',        'Delete Leads',        'Delete leads',            'delete', 40),
  ('delete_tickets',      'org', 'tickets',      'Tickets',      'Delete Tickets',      'Delete support tickets',  'delete', 40),
  ('delete_appointments', 'org', 'appointments', 'Appointments', 'Delete Appointments', 'Delete appointments',     'delete', 40),
  ('delete_customers',    'org', 'customers',    'Customers',    'Delete Customers',    'Delete customer records', 'delete', 40)
on conflict (key) do update set
  scope            = excluded.scope,
  group_slug       = excluded.group_slug,
  group_label      = excluded.group_label,
  permission_label = excluded.permission_label,
  description      = excluded.description,
  action_tier      = excluded.action_tier,
  sort_order       = excluded.sort_order;

-- ── STEP 2: re-sync the system-role bags from the catalog ───────────────────
-- Verbatim reuse of the K2c-B derivation (migration 20260630120000): rebuild the
-- Org Admin + HQ Admin bags as jsonb_object_agg(key, true) over their scope. Now
-- that STEP 1 added the 4 delete_* org keys, the Org Admin bag picks them up. The
-- ensure_organization_admin_role() trigger is already catalog-derived (K2c-B), so
-- future org-create auto-includes the new keys — no trigger change needed.
update public.roles
   set permissions = (select jsonb_object_agg(key, true) from public.permission_catalog where scope = 'org')
 where name = 'Org Admin' and organization_id is not null and is_system_role = true;

update public.roles
   set permissions = (select jsonb_object_agg(key, true) from public.permission_catalog where scope = 'hq')
 where name = 'HQ Admin' and organization_id is null and is_system_role = true;

-- ── STEP 3: retrofit member_invitations (4) → manage_team ───────────────────
-- Preserve org-scoping exactly; swap ONLY auth_user_role()='admin' for the bag
-- check. The is_admin_hq() HQ-parity policies on this table are untouched.
drop policy if exists "member_invitations: select org admin" on public.member_invitations;
create policy "member_invitations: select org admin" on public.member_invitations
  for select to public
  using ( auth_user_org_id() = organization_id and auth_user_has_permission('manage_team') );

drop policy if exists "member_invitations: insert org admin" on public.member_invitations;
create policy "member_invitations: insert org admin" on public.member_invitations
  for insert to public
  with check ( auth_user_org_id() = organization_id and auth_user_has_permission('manage_team') );

drop policy if exists "member_invitations: update org admin" on public.member_invitations;
create policy "member_invitations: update org admin" on public.member_invitations
  for update to public
  using ( auth_user_org_id() = organization_id and auth_user_has_permission('manage_team') )
  with check ( auth_user_org_id() = organization_id and auth_user_has_permission('manage_team') );

drop policy if exists "member_invitations: delete org admin" on public.member_invitations;
create policy "member_invitations: delete org admin" on public.member_invitations
  for delete to public
  using ( auth_user_org_id() = organization_id and auth_user_has_permission('manage_team') );

-- ── STEP 4: retrofit the 4 record-DELETE policies → delete_<resource> ────────
-- Normalize both predicate forms (auth_user_role() helper AND the inline
-- profiles.role subquery) to one bag-based tenant DELETE per table, scoped by
-- organization_id = auth_user_org_id(). Policy names normalized to the
-- "<table>: delete admin only" convention (pairs with the untouched
-- "<table>: delete hq_admin" HQ policies).

-- leads (was helper-form "leads: delete admin only")
drop policy if exists "leads: delete admin only" on public.leads;
create policy "leads: delete admin only" on public.leads
  for delete to public
  using ( organization_id = auth_user_org_id() and auth_user_has_permission('delete_leads') );

-- tickets: collapse the redundant pair (helper "tickets: delete admin only" +
-- inline "Admins can delete tickets") into ONE consolidated tenant DELETE.
drop policy if exists "tickets: delete admin only" on public.tickets;
drop policy if exists "Admins can delete tickets" on public.tickets;
create policy "tickets: delete admin only" on public.tickets
  for delete to public
  using ( organization_id = auth_user_org_id() and auth_user_has_permission('delete_tickets') );

-- appointments (was inline "Admins can delete appointments")
drop policy if exists "Admins can delete appointments" on public.appointments;
create policy "appointments: delete admin only" on public.appointments
  for delete to public
  using ( organization_id = auth_user_org_id() and auth_user_has_permission('delete_appointments') );

-- customers (was inline "Admins can delete customers")
drop policy if exists "Admins can delete customers" on public.customers;
create policy "customers: delete admin only" on public.customers
  for delete to public
  using ( organization_id = auth_user_org_id() and auth_user_has_permission('delete_customers') );

commit;
