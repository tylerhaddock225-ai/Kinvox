-- Kinvox — Add a metadata jsonb sidecar to pending_signals.
--
-- The intelligent-ingest route (Sprint 4 v2) extracts location_name +
-- summary from the LLM in one call and needs somewhere to persist them
-- without bespoke columns per attribute. jsonb gives us forward-compat
-- room (confidence flags, alternate locations, etc.) without another
-- migration each time the prompt evolves.
--
-- Nullable + no default — existing rows stay NULL, new rows from the
-- ingest route always provide a non-empty object. No GIN index for now;
-- add one if/when query patterns demand it.

alter table public.pending_signals
  add column if not exists metadata jsonb;
