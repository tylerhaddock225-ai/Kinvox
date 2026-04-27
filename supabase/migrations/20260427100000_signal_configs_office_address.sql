-- Add the only missing field for the human-readable address.
--
-- The dynamic signal configs table (migration 20260423000000) already
-- ships with radius_miles, keywords, and is_active — the prior audit
-- confirmed those concepts are not redundant additions. This migration
-- adds only what was actually missing: a free-text office address used
-- by the hunting-profile UI to display where the org is anchored.

alter table public.signal_configs
  add column if not exists office_address text;
