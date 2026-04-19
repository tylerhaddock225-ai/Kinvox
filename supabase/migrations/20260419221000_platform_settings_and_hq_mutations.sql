-- ============================================================
-- Migration: platform_settings table + HQ mutation grants.
--
-- Scope
--   1. Create public.platform_settings — a tiny key/value bag
--      for HQ-wide configuration. First consumer is
--      ticket_id_prefix (tk_, REQ-, etc.), but it's designed so
--      new flags can slot in without further migrations.
--   2. Rewire public.assign_ticket_display_id() so the auto-
--      assigned display_id reads the prefix from platform_settings
--      with a fallback to the historical 'tk_'. Existing rows
--      keep their old display_id — only new tickets adopt the
--      updated format.
--   3. Grant HQ admins mutation rights on tickets + ticket_messages
--      across organizations. Existing migration
--      20260419193640_admin_global_visibility.sql deliberately
--      kept admins as read-only ghosts; this migration softens
--      that for the two tables HQ support staff must operate on
--      to triage the platform_support queue (status updates,
--      replies). Merchant-scoped tables remain ghost-read-only.
--
-- Idempotent: every CREATE uses IF NOT EXISTS; every policy
-- is dropped before re-created.
-- ============================================================


-- ── 1. platform_settings ────────────────────────────────────────────────────

create table if not exists public.platform_settings (
  key         text        primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid                 references public.profiles(id) on delete set null
);

alter table public.platform_settings enable row level security;

drop policy if exists "HQ admins can read platform_settings"   on public.platform_settings;
drop policy if exists "HQ admins can write platform_settings"  on public.platform_settings;

create policy "HQ admins can read platform_settings"
  on public.platform_settings
  for select
  to authenticated
  using (public.is_admin_hq());

create policy "HQ admins can write platform_settings"
  on public.platform_settings
  for all
  to authenticated
  using      (public.is_admin_hq())
  with check (public.is_admin_hq());

-- Seed the default ticket ID prefix so the rewired trigger in step 2 finds
-- a row immediately. ON CONFLICT DO NOTHING keeps subsequent re-runs idempotent.
insert into public.platform_settings (key, value)
  values ('ticket_id_prefix', '"tk_"'::jsonb)
  on conflict (key) do nothing;


-- ── 2. Rewire display-id trigger to honor the configurable prefix ───────────

create or replace function public.assign_ticket_display_id()
returns trigger language plpgsql as $$
declare
  prefix text;
begin
  if new.display_id is null then
    -- Read the configured prefix; fall back to 'tk_' if the row is missing
    -- or ever set to something that isn't a string.
    select coalesce(value #>> '{}', 'tk_')
      into prefix
      from public.platform_settings
     where key = 'ticket_id_prefix';

    new.display_id := coalesce(prefix, 'tk_') || nextval('public.tickets_display_seq');
  end if;
  return new;
end;
$$;

-- Trigger binding from the original migration is still in place; no need to
-- drop/re-create — CREATE OR REPLACE on the function is sufficient.


-- ── 3. HQ mutation grants on tickets + ticket_messages ──────────────────────
--
-- Rationale: admins need to close and reply to tickets from /admin-hq/tickets.
-- Grant is role-gated (is_admin_hq()) and table-scoped; merchant-owned tables
-- outside this pair (customers, leads, appointments, etc.) still follow the
-- ghost-read-only doctrine.

-- 3a. tickets — UPDATE bypass for HQ admins.
drop policy if exists "HQ admins can update tickets" on public.tickets;
create policy "HQ admins can update tickets"
  on public.tickets
  for update
  to authenticated
  using      (public.is_admin_hq())
  with check (public.is_admin_hq());

-- 3b. ticket_messages — INSERT bypass for HQ admins.
--     sender_id must still be the caller (audit trail), but the parent-ticket
--     org check is relaxed for HQ staff.
drop policy if exists "HQ admins can insert ticket messages" on public.ticket_messages;
create policy "HQ admins can insert ticket messages"
  on public.ticket_messages
  for insert
  to authenticated
  with check (
    public.is_admin_hq()
    and sender_id = auth.uid()
  );
