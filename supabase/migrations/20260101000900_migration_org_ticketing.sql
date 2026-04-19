-- ============================================================
-- Migration: Org isolation for ticketing + inbound email plumbing.
-- Run in Supabase → SQL Editor.
--
-- Notes
--  • `tickets.organization_id` already exists from schema.sql and serves as
--    the org link. We do NOT add a duplicate `org_id` column here. New code
--    should keep using `organization_id` for tickets to match the rest of
--    the schema (leads, appointments, etc.).
--  • `ticket_messages` did not have an org column before — we add `org_id`
--    here so RLS can filter without joining through `tickets`.
-- ============================================================


-- ── 1. organizations.inbound_email_address + verified_support_email ─────────

alter table public.organizations
  add column if not exists inbound_email_address               text,
  add column if not exists verified_support_email              text,
  add column if not exists verified_support_email_confirmed_at timestamptz;

create unique index if not exists organizations_inbound_email_unique
  on public.organizations(lower(inbound_email_address))
  where inbound_email_address is not null;


-- ── 2. ticket_messages columns ──────────────────────────────────────────────

alter table public.ticket_messages
  add column if not exists org_id              uuid,
  add column if not exists external_message_id text;

-- Backfill org_id from the parent ticket
update public.ticket_messages tm
   set org_id = t.organization_id
  from public.tickets t
 where tm.ticket_id = t.id
   and tm.org_id is null;

alter table public.ticket_messages
  alter column org_id set not null;

alter table public.ticket_messages
  drop constraint if exists ticket_messages_org_id_fkey;
alter table public.ticket_messages
  add constraint ticket_messages_org_id_fkey
  foreign key (org_id) references public.organizations(id) on delete cascade;

create index if not exists ticket_messages_org_idx
  on public.ticket_messages(org_id);

create unique index if not exists ticket_messages_external_id_unique
  on public.ticket_messages(org_id, external_message_id)
  where external_message_id is not null;


-- ── 3. RLS — ticket_messages (rewritten to key off org_id directly) ─────────

alter table public.ticket_messages enable row level security;

drop policy if exists "Org members can view ticket messages"      on public.ticket_messages;
drop policy if exists "Org members can insert ticket messages"    on public.ticket_messages;
drop policy if exists "Authors can delete their own ticket messages" on public.ticket_messages;

create policy "Org members can view ticket messages"
  on public.ticket_messages for select
  using (
    org_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Org members can insert ticket messages"
  on public.ticket_messages for insert
  with check (
    sender_id = auth.uid()
    and org_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Authors can delete their own ticket messages"
  on public.ticket_messages for delete
  using (sender_id = auth.uid());


-- ── 4. RLS — tickets (re-affirm org isolation) ──────────────────────────────
-- Policies from schema.sql already enforce this; re-create them idempotently
-- so this migration is self-contained when applied to a fresh DB.

alter table public.tickets enable row level security;

drop policy if exists "Org members can view tickets"   on public.tickets;
drop policy if exists "Org members can insert tickets" on public.tickets;
drop policy if exists "Org members can update tickets" on public.tickets;
drop policy if exists "Admins can delete tickets"      on public.tickets;

create policy "Org members can view tickets"
  on public.tickets for select
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Org members can insert tickets"
  on public.tickets for insert
  with check (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Org members can update tickets"
  on public.tickets for update
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Admins can delete tickets"
  on public.tickets for delete
  using (
    organization_id in (
      select organization_id from public.profiles
       where id = auth.uid() and role = 'admin'
    )
  );
