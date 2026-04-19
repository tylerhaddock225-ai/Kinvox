-- ============================================================
-- Migration: Customers entity (schema + backfill, consolidated).
-- Run in Supabase → SQL Editor.
--
-- Scope
--   • Create the customers table, sequence, indexes, RLS, and the
--     standard updated_at trigger.
--   • Add customer_id columns to tickets and appointments.
--   • Backfill: every existing lead becomes a customer; tickets and
--     appointments inherit a customer_id from their existing lead_id.
--
-- Deliberately OUT OF SCOPE — handled in code (see actions/leads.ts and
-- actions/{tickets,appointments}.ts) because the SQL editor was rejecting
-- PL/pgSQL function bodies that referenced NEW:
--   • Auto-mirror trigger on lead INSERT.
--   • fill_customer_id_from_lead BEFORE-INSERT trigger.
--
-- The file is fully idempotent — every CREATE uses IF NOT EXISTS / OR
-- REPLACE and the backfill INSERT is gated on WHERE NOT EXISTS, so
-- re-running cleans up partial state and is otherwise a no-op.
-- ============================================================


-- ── 0. Defensive cleanup of partial state from earlier failed runs ────────

drop trigger if exists assign_customer_display_id     on public.customers;
drop trigger if exists set_customers_updated_at       on public.customers;
drop trigger if exists mirror_lead_to_customer        on public.leads;
drop trigger if exists fill_ticket_customer_from_lead on public.tickets;
drop trigger if exists fill_appt_customer_from_lead   on public.appointments;

drop function if exists public.assign_customer_display_id();
drop function if exists public.mirror_lead_to_customer();
drop function if exists public.fill_customer_id_from_lead();


-- ── 1. Sequence for display_id (must exist before the table DEFAULT) ─────

create sequence if not exists public.customers_display_seq start 1;


-- ── 2. customers table ────────────────────────────────────────────────────

create table if not exists public.customers (
  id              uuid        primary key default gen_random_uuid(),
  display_id      text        not null default ('cu_' || nextval('public.customers_display_seq')::text),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  lead_id         uuid                  references public.leads(id)        on delete set null,
  first_name      text        not null,
  last_name       text,
  email           text,
  phone           text,
  company         text,
  notes           text,
  metadata        jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);


-- ── 3. Indexes ───────────────────────────────────────────────────────────

create index if not exists customers_org_idx
  on public.customers(organization_id);

-- One customer per (org, email). Allows re-importing without duplicates.
create unique index if not exists customers_org_email_unique
  on public.customers(organization_id, lower(email))
  where deleted_at is null and email is not null;

-- One customer per source lead.
create unique index if not exists customers_lead_unique
  on public.customers(lead_id)
  where lead_id is not null;

create unique index if not exists customers_display_id_unique
  on public.customers(display_id);


-- ── 4. updated_at trigger (re-uses existing public.set_updated_at) ───────
-- Attaches the existing function — no new PL/pgSQL body created here.
-- Re-creating is safe because section 0 dropped any prior version.

create trigger set_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();


-- ── 5. RLS — same shape as leads ─────────────────────────────────────────

alter table public.customers enable row level security;

drop policy if exists "Org members can view customers"   on public.customers;
drop policy if exists "Org members can insert customers" on public.customers;
drop policy if exists "Org members can update customers" on public.customers;
drop policy if exists "Admins can delete customers"      on public.customers;

create policy "Org members can view customers"
  on public.customers for select
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Org members can insert customers"
  on public.customers for insert
  with check (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Org members can update customers"
  on public.customers for update
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Admins can delete customers"
  on public.customers for delete
  using (
    organization_id in (
      select organization_id from public.profiles
       where id = auth.uid() and role = 'admin'
    )
  );


-- ── 6. customer_id columns on tickets + appointments ─────────────────────

alter table public.tickets
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists tickets_customer_idx on public.tickets(customer_id);

alter table public.appointments
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists appointments_customer_idx on public.appointments(customer_id);


-- ── 7. Backfill: leads → customers ───────────────────────────────────────
-- Plain INSERT … SELECT … WHERE NOT EXISTS — no joins, no aliases. Skips
-- leads that already mirror a customer (so re-runs are no-ops).

insert into public.customers
  (organization_id, lead_id, first_name, last_name, email, phone, company)
select
  public.leads.organization_id,
  public.leads.id,
  public.leads.first_name,
  public.leads.last_name,
  public.leads.email,
  public.leads.phone,
  public.leads.company
from public.leads
where public.leads.deleted_at is null
  and not exists (
    select 1 from public.customers
     where public.customers.lead_id = public.leads.id
  );


-- ── 8. Backfill: customer_id on tickets ──────────────────────────────────
-- Scalar subquery against the lead → customer mapping. Skips rows that
-- already have customer_id set.

update public.tickets
   set customer_id = (
     select public.customers.id
       from public.customers
      where public.customers.lead_id = public.tickets.lead_id
      limit 1
   )
 where public.tickets.customer_id is null
   and public.tickets.lead_id     is not null;


-- ── 9. Backfill: customer_id on appointments ─────────────────────────────

update public.appointments
   set customer_id = (
     select public.customers.id
       from public.customers
      where public.customers.lead_id = public.appointments.lead_id
      limit 1
   )
 where public.appointments.customer_id is null
   and public.appointments.lead_id     is not null;
