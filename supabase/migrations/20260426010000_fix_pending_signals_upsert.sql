-- Kinvox — Make the per-tenant signal-dedup index ON CONFLICT-inferable.
--
-- The previous partial index (where external_post_id is not null) cannot
-- be inferred by INSERT ... ON CONFLICT (organization_id, external_post_id)
-- unless the same WHERE predicate is repeated in the conflict target. The
-- supabase-js .upsert() helper does not emit that predicate, so every
-- successful triage was failing with:
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- Replace it with a non-partial unique index. Per PostgreSQL's default
-- NULLS DISTINCT semantics, multiple rows with NULL external_post_id
-- (the legacy capture path) still do not collide, so we lose nothing by
-- dropping the WHERE clause.

drop index if exists public.pending_signals_org_external_post_uniq;

create unique index if not exists pending_signals_org_external_post_uniq
  on public.pending_signals (organization_id, external_post_id);
