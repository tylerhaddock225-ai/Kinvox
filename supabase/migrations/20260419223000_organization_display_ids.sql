-- ============================================================
-- Migration: Human-readable display IDs for organizations.
--
-- Mirrors the pattern from 20260101000500_migration_display_ids.sql
-- for leads / appointments / tickets. Adds display_id to
-- public.organizations, backfills existing rows in created_at
-- order, advances the sequence past the backfill max, wires an
-- auto-assign trigger for future inserts, and adds a unique
-- index so lookups by display_id can round-trip.
--
-- Idempotent.
-- ============================================================


-- ── 1. Column ────────────────────────────────────────────────────────────────

alter table public.organizations add column if not exists display_id text;


-- ── 2. Sequence ──────────────────────────────────────────────────────────────

create sequence if not exists public.organizations_display_seq start 1;


-- ── 3. Backfill existing rows (oldest first) ─────────────────────────────────

with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.organizations where display_id is null
)
update public.organizations o
   set display_id = 'org_' || x.rn
  from ordered x
 where o.id = x.id;


-- ── 4. Advance sequence past the backfilled max ─────────────────────────────

select setval(
  'public.organizations_display_seq',
  greatest(1, coalesce(
    (select max(substring(display_id from 5)::bigint)
       from public.organizations
      where display_id ~ '^org_[0-9]+$'),
    0
  ))
);


-- ── 5. Auto-assign trigger for future inserts ───────────────────────────────

create or replace function public.assign_organization_display_id()
returns trigger language plpgsql as $$
begin
  if new.display_id is null then
    new.display_id := 'org_' || nextval('public.organizations_display_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists assign_organization_display_id on public.organizations;
create trigger assign_organization_display_id
  before insert on public.organizations
  for each row execute function public.assign_organization_display_id();


-- ── 6. Uniqueness + lookup index ─────────────────────────────────────────────

create unique index if not exists organizations_display_id_unique
  on public.organizations(display_id);
