-- Pay-on-Unlock infrastructure.
--
-- Shifts the billing event from capture-time to unlock-time. The capture
-- flow now inserts leads as `pending_unlock` (PII still stored, never
-- shown), and a tenant action later atomically deducts 1 credit and
-- flips the status to `new` to reveal contact details.
--
-- Three changes:
--   1. Widen leads_status_check to allow 'pending_unlock'.
--   2. Add unlocked_at + unlocked_by audit columns.
--   3. Partial unique index on credit_ledger(reference_id) where
--      type='signal_deduction' so a double-clicked Unlock can't double-bill
--      even if the action layer's gate races.

-- ── 1. leads.status: allow 'pending_unlock' ──────────────────────────
alter table public.leads
  drop constraint if exists leads_status_check;

alter table public.leads
  add constraint leads_status_check
  check (status = any (array[
    'new'::text,
    'contacted'::text,
    'qualified'::text,
    'lost'::text,
    'converted'::text,
    'pending_unlock'::text
  ]));

-- ── 2. unlock audit columns ──────────────────────────────────────────
-- unlocked_at is the canonical "this lead was paid for" marker. When NULL,
-- the lead is still in pending_unlock state (or was created before the
-- pay-on-unlock cutover and grandfathered as already-visible).
-- unlocked_by points at the user who paid the credit; useful for HQ
-- reconciliation when a credit dispute names a specific employee.
alter table public.leads
  add column if not exists unlocked_at timestamptz,
  add column if not exists unlocked_by uuid references auth.users(id);

-- Lookups for "show me my unlocked-this-month leads" and audit pulls.
create index if not exists leads_unlocked_at_idx
  on public.leads(unlocked_at desc)
  where unlocked_at is not null;

-- ── 3. credit_ledger idempotency guard ───────────────────────────────
-- Race protection: if the unlockLead action fires twice (double-click,
-- network retry) before the status flip lands, the second deduct_credit()
-- INSERT will hit this index and 23505 instead of completing the deduction.
-- The wrapper in src/lib/credits.ts can interpret 23505 as "already paid"
-- and return success without charging again.
--
-- Scoped to type='signal_deduction' so manual purchase / refund / adjustment
-- rows (which legitimately may share a reference_id with a lead) are not
-- constrained by this rule.
create unique index if not exists credit_ledger_signal_dedup
  on public.credit_ledger(reference_id)
  where type = 'signal_deduction'
    and reference_id is not null;
