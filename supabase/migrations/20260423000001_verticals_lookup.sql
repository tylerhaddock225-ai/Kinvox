-- Kinvox — Verticals lookup + canonicalization + FK wiring.
--
-- Before this migration, organizations.vertical was free-text. This
-- migration introduces a central registry (public.verticals) so
-- organizations and signal_configs both reference a canonical slug, and
-- HQ can add/retire verticals without a code deploy.
--
-- Safety:
--   The preflight DO block RAISES if organizations.vertical (or the
--   freshly-created signal_configs.vertical) holds values that won't
--   match the seed. Without it, the FK add would produce a cryptic
--   23503 mid-transaction. Clean up, then re-run.
--
-- Spec scope note:
--   Prod audit found the only non-canonical values in use were
--   'Home Preparedness' and 'General'. Both are canonicalized to their
--   slugs below ('home_preparedness', 'general'), and 'general' is
--   seeded into public.verticals alongside the rest. Any other
--   free-text value encountered by the preflight still raises so an
--   operator can enumerate + map it before re-running.


-- ─────────────────────────────────────────────────────────────
-- 1. public.verticals  (lookup)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.verticals (
  id         text    primary key,
  label      text    not null,
  is_active  boolean not null default true
);

insert into public.verticals (id, label) values
  ('home_preparedness', 'Home Preparedness'),
  ('roofing',           'Roofing'),
  ('construction',      'Construction'),
  ('dental',            'Dental'),
  ('healthcare',        'Healthcare'),
  ('general',           'General')
on conflict (id) do nothing;

alter table public.verticals enable row level security;

-- Lookup data — any authenticated session reads; only HQ writes.
create policy "verticals: read all authenticated"
  on public.verticals for select
  to authenticated
  using (true);

create policy "verticals: hq write"
  on public.verticals for all
  to authenticated
  using (public.is_admin_hq())
  with check (public.is_admin_hq());

grant select on public.verticals to authenticated;
grant all    on public.verticals to service_role;


-- ─────────────────────────────────────────────────────────────
-- 2. Canonicalize existing organizations.vertical data
--    (spec-specified cleanup)
-- ─────────────────────────────────────────────────────────────

update public.organizations
   set vertical = 'home_preparedness'
 where vertical = 'Home Preparedness';

update public.organizations
   set vertical = 'general'
 where vertical = 'General';


-- ─────────────────────────────────────────────────────────────
-- 3. Preflight — enumerate un-canonicalized values so the FK add
--    doesn't blow up mid-transaction with an opaque 23503.
-- ─────────────────────────────────────────────────────────────

do $$
declare
  bad_orgs    text;
  bad_configs text;
begin
  select string_agg(distinct vertical, ', ' order by vertical)
    into bad_orgs
    from public.organizations
   where vertical is not null
     and vertical not in (select id from public.verticals);

  if bad_orgs is not null then
    raise exception
      'organizations.vertical has un-canonicalized values: %. UPDATE each to a seeded slug (or NULL), then re-run this migration.',
      bad_orgs;
  end if;

  select string_agg(distinct vertical, ', ' order by vertical)
    into bad_configs
    from public.signal_configs
   where vertical is not null
     and vertical not in (select id from public.verticals);

  if bad_configs is not null then
    raise exception
      'signal_configs.vertical has un-canonicalized values: %. UPDATE each to a seeded slug before re-running.',
      bad_configs;
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────
-- 4. FK wiring
--    RESTRICT on delete — a vertical in use cannot be removed.
--    CASCADE  on update — renaming a slug propagates.
-- ─────────────────────────────────────────────────────────────

alter table public.organizations
  drop constraint if exists organizations_vertical_fkey;

alter table public.organizations
  add constraint organizations_vertical_fkey
  foreign key (vertical) references public.verticals(id)
  on delete restrict on update cascade;

alter table public.signal_configs
  drop constraint if exists signal_configs_vertical_fkey;

alter table public.signal_configs
  add constraint signal_configs_vertical_fkey
  foreign key (vertical) references public.verticals(id)
  on delete restrict on update cascade;
