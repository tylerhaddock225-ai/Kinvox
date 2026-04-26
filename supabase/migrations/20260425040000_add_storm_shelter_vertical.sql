-- Kinvox — Register the 'storm_shelter' vertical in the canonical lookup.
--
-- Adds a new entry to public.verticals so organizations and signal_configs
-- can FK-reference it. Idempotent: ON CONFLICT (id) DO NOTHING means re-runs
-- and environments where it was already inserted manually are no-ops.
--
-- Schema reminder (from 20260423000001_verticals_lookup.sql):
--   public.verticals(id text primary key, label text not null,
--                    is_active boolean not null default true)
-- The original spec used (slug, name, description) — those columns don't
-- exist on this table; (id, label) is the correct shape.

insert into public.verticals (id, label) values
  ('storm_shelter', 'Storm Shelters')
on conflict (id) do nothing;
