-- Workstream E — ticket_recipients table.
--
-- Stores the recipient list for a ticket (To + Cc) as structured rows rather
-- than relying on tickets.customer_id alone. Each row is either a user-linked
-- profile (user_id) or a free-form email (email) — exactly one populated. This
-- lets a ticket fan a reply out to multiple addresses (customers + their
-- assistants on Cc) without overloading customers, and gives the org→HQ
-- recipient model a place to grow.
--
-- For inbound customer→org tickets created by the Postmark webhook, a single
-- 'to' row is seeded with the sender's email (and added_by = org.owner_id,
-- matching tickets.created_by).
--
-- Outbound resolution: dispatchOutboundEmail / dispatchClosureEmail query
-- this table first; rows with email populate To/Cc directly, rows with
-- user_id resolve via supabase.auth.admin.getUserById(). When no recipients
-- exist (legacy pre-table tickets), the dispatchers fall back to the
-- customers.email + ticket_messages.inbound_email_from tiers.
--
-- RLS parity matches the lead_views / hq_admin_rls_parity migrations: org
-- members can see/insert/delete recipients of their own org's tickets via
-- the tickets join; HQ admins get full parity for impersonation. UPDATE is
-- intentionally omitted — recipients are add/remove, not editable in place.

begin;

create table public.ticket_recipients (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind text not null check (kind in ('to', 'cc')),
  user_id uuid references public.profiles(id) on delete set null,
  email text,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles(id) on delete set null,
  constraint ticket_recipients_one_target check (
    (user_id is not null and email is null)
    or (user_id is null and email is not null)
  )
);

-- Per-kind uniqueness — same user can be 'to' on one ticket and 'cc' on
-- another, but cannot be listed twice with the same kind on the same ticket.
create unique index ticket_recipients_user_unique
  on public.ticket_recipients (ticket_id, kind, user_id)
  where user_id is not null;

-- Email uniqueness is case-insensitive (lower()) so "Foo@bar" and "foo@bar"
-- can't both be added as separate rows.
create unique index ticket_recipients_email_unique
  on public.ticket_recipients (ticket_id, kind, lower(email))
  where email is not null;

-- Fan-out lookup index — dispatchers query "all recipients for this ticket".
create index ticket_recipients_ticket_idx
  on public.ticket_recipients (ticket_id);

alter table public.ticket_recipients enable row level security;

-- SELECT: org members see recipients of their org's tickets; HQ admins see all.
drop policy if exists "ticket_recipients: select org member" on public.ticket_recipients;
create policy "ticket_recipients: select org member"
  on public.ticket_recipients for select
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_recipients.ticket_id
        and t.organization_id = public.auth_user_org_id()
    )
  );

drop policy if exists "ticket_recipients: select hq admin" on public.ticket_recipients;
create policy "ticket_recipients: select hq admin"
  on public.ticket_recipients for select
  using (public.is_admin_hq());

-- INSERT: org members can add recipients to their org's tickets; HQ admins
-- can add to any.
drop policy if exists "ticket_recipients: insert org member" on public.ticket_recipients;
create policy "ticket_recipients: insert org member"
  on public.ticket_recipients for insert
  with check (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_recipients.ticket_id
        and t.organization_id = public.auth_user_org_id()
    )
  );

drop policy if exists "ticket_recipients: insert hq admin" on public.ticket_recipients;
create policy "ticket_recipients: insert hq admin"
  on public.ticket_recipients for insert
  with check (public.is_admin_hq());

-- DELETE: org members can remove recipients from their org's tickets; HQ
-- admins parity.
drop policy if exists "ticket_recipients: delete org member" on public.ticket_recipients;
create policy "ticket_recipients: delete org member"
  on public.ticket_recipients for delete
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_recipients.ticket_id
        and t.organization_id = public.auth_user_org_id()
    )
  );

drop policy if exists "ticket_recipients: delete hq admin" on public.ticket_recipients;
create policy "ticket_recipients: delete hq admin"
  on public.ticket_recipients for delete
  using (public.is_admin_hq());

-- UPDATE intentionally omitted — recipients are add/remove, not editable in place.

commit;
