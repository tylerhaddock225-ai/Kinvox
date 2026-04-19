-- ============================================================
-- Migration: customers.archived_at (user-initiated archive flag).
--
-- Note on scope vs. task wording
--   The accompanying feature asks for \u2018status\u2019 + \u2018archived_at\u2019. The
--   status column already exists (added in 20260419210652) and
--   customers.deleted_at is the pre-existing soft-delete marker
--   used by RLS / join filters. We intentionally do NOT reuse
--   deleted_at for archive \u2014 keeping them distinct lets the
--   customer grid expose \u201CShow Archived\u201D without ever surfacing
--   truly-deleted rows.
--
-- This migration only adds the new archived_at column + an
-- index to make the \u201Carchived_at IS NULL\u201D grid query cheap.
-- Idempotent.
-- ============================================================

alter table public.customers
  add column if not exists archived_at timestamptz;

-- Partial index for the default (non-archived) grid query.
create index if not exists customers_archived_at_idx
  on public.customers(organization_id)
  where archived_at is null and deleted_at is null;
