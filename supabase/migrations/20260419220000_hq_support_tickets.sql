-- ============================================================
-- Migration: HQ platform-support fields on public.tickets.
--
-- Scope
--   • Add is_platform_support (boolean, default false, NOT NULL).
--       Tickets with this flag = merchant→Kinvox HQ support requests.
--       Merchant ticket lists filter them out in the query layer so
--       merchants don't see them mixed in with their customer tickets;
--       Admin HQ surfaces them via a "Platform Support" scope filter.
--   • Add hq_category (text, nullable, CHECK constrained).
--       Categorizes an HQ support ticket: bug | billing |
--       feature_request | question. NULL for regular tickets.
--   • Add screenshot_url (text, nullable).
--       Optional URL the merchant pastes into the support modal so we
--       can eyeball their screenshot without a full upload pipeline.
--
-- Why flag-based over a dedicated "Kinvox HQ" org_id
--   Cross-org inserts are blocked by RLS (tickets.insert policy requires
--   organization_id ∈ caller's profile.organization_id). Routing by flag
--   keeps the merchant's own RLS policy intact — the ticket lives in the
--   merchant's org, the flag tells admins who should act on it.
--
-- Idempotent: every ALTER uses IF NOT EXISTS.
-- ============================================================


-- ── 1. Columns ──────────────────────────────────────────────────────────────

alter table public.tickets
  add column if not exists is_platform_support boolean not null default false;

alter table public.tickets
  add column if not exists hq_category text;

alter table public.tickets
  add column if not exists screenshot_url text;


-- ── 2. CHECK constraint on hq_category (guarded — ALTER has no IF NOT EXISTS) ──

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_hq_category_check'
  ) then
    alter table public.tickets
      add constraint tickets_hq_category_check
      check (hq_category is null or hq_category in ('bug', 'billing', 'feature_request', 'question'));
  end if;
end$$;


-- ── 3. Index for Admin HQ's Platform Support filter ─────────────────────────

-- Partial index keyed on created_at so the "is_platform_support = true"
-- scope in /admin-hq/tickets can sort the newest first without scanning
-- the (much larger) merchant-ticket slab.
create index if not exists tickets_platform_support_created_at_idx
  on public.tickets (created_at desc)
  where is_platform_support = true;
