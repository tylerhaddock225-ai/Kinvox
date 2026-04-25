-- Pay-on-Unlock for signals.
--
-- Sprint 3 pivot: the unlock paywall moves from leads to pending_signals.
-- A new signal lands as 'pending' with raw_text + ai_draft_reply hidden in
-- the dashboard. The merchant pays 1 credit to flip it to 'unlocked',
-- which reveals the post text and enables the AI reply send button.
--
-- The credit_ledger_signal_dedup partial unique index from the lead-unlock
-- migration is intentionally reused here — reference_id will now be the
-- pending_signal id instead of the lead id, and the index protects both.
--
-- The 'pending_unlock' value left over on leads_status_check stays put.
-- It's harmless dead code on the leads side; cheaper than a down-migration.

-- ── 1. pending_signals.status: allow 'unlocked' ──────────────────────
alter table public.pending_signals
  drop constraint if exists pending_signals_status_check;

alter table public.pending_signals
  add constraint pending_signals_status_check
  check (status in ('pending', 'unlocked', 'approved', 'dismissed'));

-- ── 2. unlock audit columns ──────────────────────────────────────────
-- unlocked_at is the canonical "this signal was paid for" marker. NULL
-- means still in the locked teaser state (or pre-cutover row).
-- unlocked_by points at the user who paid the credit, useful for HQ
-- reconciliation when a credit dispute names a specific employee.
alter table public.pending_signals
  add column if not exists unlocked_at timestamptz,
  add column if not exists unlocked_by uuid references auth.users(id);

-- Lookups for "show me my unlocked-this-week signals" and audit pulls.
create index if not exists pending_signals_unlocked_at_idx
  on public.pending_signals(unlocked_at desc)
  where unlocked_at is not null;
