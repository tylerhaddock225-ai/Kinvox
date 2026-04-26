-- Kinvox — Per-tenant deduplication for global signal ingest.
--
-- The new POST /api/v1/signals/ingest route fans a single source post out
-- to every active org in the vertical whose geofence covers the signal.
-- Without a uniqueness guarantee at the DB layer, a re-emitted Reddit URL
-- (poll cycles, retries, etc.) would land twice in the same dashboard.
--
-- Scope choice: (organization_id, external_post_id) instead of a global
-- unique on external_post_id. The same URL legitimately fans out to N
-- orgs on first ingest; re-ingest of that URL must be a no-op per org.
-- Partial index — external_post_id is nullable for the legacy capture
-- path, and NULLs must not collide.

create unique index if not exists pending_signals_org_external_post_uniq
  on public.pending_signals (organization_id, external_post_id)
  where external_post_id is not null;
