-- ============================================================
-- Migration: Human-readable display IDs for leads / appointments / tickets
-- Run in Supabase → SQL Editor.
-- ============================================================


-- ── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.leads        add column if not exists display_id text;
alter table public.appointments add column if not exists display_id text;
alter table public.tickets      add column if not exists display_id text;


-- ── 2. Sequences ────────────────────────────────────────────────────────────

create sequence if not exists public.leads_display_seq        start 1;
create sequence if not exists public.appointments_display_seq start 1;
create sequence if not exists public.tickets_display_seq      start 1;


-- ── 3. Backfill existing rows (in created_at order) ────────────────────────

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.leads where display_id is null
)
update public.leads l
   set display_id = 'ld_' || o.rn
  from ordered o
 where l.id = o.id;

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.appointments where display_id is null
)
update public.appointments a
   set display_id = 'ap_' || o.rn
  from ordered o
 where a.id = o.id;

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.tickets where display_id is null
)
update public.tickets t
   set display_id = 'tk_' || o.rn
  from ordered o
 where t.id = o.id;


-- ── 4. Advance sequences past the backfilled max ───────────────────────────

select setval(
  'public.leads_display_seq',
  greatest(1, coalesce(
    (select max(substring(display_id from 4)::bigint)
       from public.leads
      where display_id ~ '^ld_[0-9]+$'),
    0
  ))
);

select setval(
  'public.appointments_display_seq',
  greatest(1, coalesce(
    (select max(substring(display_id from 4)::bigint)
       from public.appointments
      where display_id ~ '^ap_[0-9]+$'),
    0
  ))
);

select setval(
  'public.tickets_display_seq',
  greatest(1, coalesce(
    (select max(substring(display_id from 4)::bigint)
       from public.tickets
      where display_id ~ '^tk_[0-9]+$'),
    0
  ))
);


-- ── 5. Auto-assign trigger for future inserts ──────────────────────────────

create or replace function public.assign_lead_display_id()
returns trigger language plpgsql as $$
begin
  if new.display_id is null then
    new.display_id := 'ld_' || nextval('public.leads_display_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists assign_lead_display_id on public.leads;
create trigger assign_lead_display_id
  before insert on public.leads
  for each row execute function public.assign_lead_display_id();

create or replace function public.assign_appointment_display_id()
returns trigger language plpgsql as $$
begin
  if new.display_id is null then
    new.display_id := 'ap_' || nextval('public.appointments_display_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists assign_appointment_display_id on public.appointments;
create trigger assign_appointment_display_id
  before insert on public.appointments
  for each row execute function public.assign_appointment_display_id();

create or replace function public.assign_ticket_display_id()
returns trigger language plpgsql as $$
begin
  if new.display_id is null then
    new.display_id := 'tk_' || nextval('public.tickets_display_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists assign_ticket_display_id on public.tickets;
create trigger assign_ticket_display_id
  before insert on public.tickets
  for each row execute function public.assign_ticket_display_id();


-- ── 6. Uniqueness + lookup indexes ─────────────────────────────────────────

create unique index if not exists leads_display_id_unique        on public.leads(display_id);
create unique index if not exists appointments_display_id_unique on public.appointments(display_id);
create unique index if not exists tickets_display_id_unique      on public.tickets(display_id);
