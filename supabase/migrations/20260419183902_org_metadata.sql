-- ============================================================
-- Migration: Organization metadata (vertical + status).
-- Run via `supabase db push`.
--
-- Scope
--   • Add 'vertical' (nullable text) — e.g. 'Dental',
--     'Home Preparedness', 'Payment Facilitation'.
--   • Add 'status' (text, default 'active') — lifecycle state
--     independent of Stripe's subscription_status.
--   • Backfill 'vertical' = 'General' for any rows where it is
--     NULL so the Admin HQ list renders meaningful values.
--
-- Fully idempotent: ADD COLUMN uses IF NOT EXISTS and the
-- backfill is gated on IS NULL.
--
-- NOTE: filename prefix (20260419183902_) is required by the
-- Supabase CLI (pattern: <timestamp>_name.sql). The logical
-- name requested by the task is 'migration_org_metadata.sql'.
-- ============================================================


-- ── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists vertical text;

alter table public.organizations
  add column if not exists status text not null default 'active';


-- ── 2. Backfill ─────────────────────────────────────────────────────────────

update public.organizations
   set vertical = 'General'
 where vertical is null;
