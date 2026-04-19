-- ============================================================
-- Migration: HQ form toggles.
--
-- Scope
--   1. Relax platform_settings SELECT to all authenticated users.
--      These rows are UI configuration (toggles, prefix) consumed
--      by the merchant-facing HQSupportModal and by the ticket
--      display_id trigger. Writes remain HQ-admin-only.
--      Side benefit: the prior migration\u2019s
--      assign_ticket_display_id() trigger runs as SECURITY INVOKER
--      so a merchant insert couldn\u2019t read the configured prefix
--      under the old RLS \u2014 it always fell back to \u2018tk_\u2019.
--   2. Harden that trigger with SECURITY DEFINER so the configured
--      prefix applies even if the SELECT policy is ever tightened
--      again in future migrations.
--   3. Seed show_affected_tab_field / show_record_id_field defaults
--      (both false) so the new toggles have a row on first load.
--   4. Add tickets.affected_tab (CHECK-constrained) and
--      tickets.record_id (free-form text) so merchant submissions
--      of those optional fields persist cleanly.
--
-- Idempotent.
-- ============================================================


-- ── 1. Broaden SELECT on platform_settings ───────────────────────────────────

drop policy if exists "HQ admins can read platform_settings"      on public.platform_settings;
drop policy if exists "Authenticated can read platform_settings"  on public.platform_settings;

create policy "Authenticated can read platform_settings"
  on public.platform_settings
  for select
  to authenticated
  using (true);


-- ── 2. Re-declare display-id trigger as SECURITY DEFINER ────────────────────

create or replace function public.assign_ticket_display_id()
returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  prefix text;
begin
  if new.display_id is null then
    select coalesce(value #>> '{}', 'tk_')
      into prefix
      from public.platform_settings
     where key = 'ticket_id_prefix';

    new.display_id := coalesce(prefix, 'tk_') || nextval('public.tickets_display_seq');
  end if;
  return new;
end;
$$;


-- ── 3. Seed the two new toggles (idempotent) ────────────────────────────────

insert into public.platform_settings (key, value)
  values ('show_affected_tab_field', 'false'::jsonb)
  on conflict (key) do nothing;

insert into public.platform_settings (key, value)
  values ('show_record_id_field', 'false'::jsonb)
  on conflict (key) do nothing;


-- ── 4. New ticket columns ───────────────────────────────────────────────────

alter table public.tickets
  add column if not exists affected_tab text;

alter table public.tickets
  add column if not exists record_id text;

-- CHECK constraint on affected_tab (values must track the client tab list
-- in HQSupportModal / createHQSupportTicket). Guarded because ALTER TABLE
-- ADD CONSTRAINT has no IF NOT EXISTS form.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tickets_affected_tab_check'
  ) then
    alter table public.tickets
      add constraint tickets_affected_tab_check
      check (
        affected_tab is null
        or affected_tab in ('dashboard', 'leads', 'customers', 'appointments', 'tickets', 'settings')
      );
  end if;
end$$;
