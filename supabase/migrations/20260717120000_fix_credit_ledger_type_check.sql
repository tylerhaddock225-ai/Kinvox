-- HOTFIX — credit_ledger_type_check blocks AI credit deductions.
--
-- Root cause: N Stage 1 (20260715120000) widened deduct_credit() to write its
-- p_reason argument (the AI action label, e.g. 'ticket_reply' / 'ai_reply', and
-- 'review_reply' coming in Stage 3) into credit_ledger.type. But the original
-- CHECK from 20260422000005 still allowlisted only the legacy signals-era set
--   ('signal_deduction', 'purchase', 'refund', 'adjustment')
-- so every AI deduction raised:
--   new row for relation "credit_ledger" violates check constraint
--   "credit_ledger_type_check"
--
-- Fix: type is now a server-controlled reason label. Every writer is trusted —
-- deduct_credit() and add_credits() are service_role-only and pass hardcoded /
-- server-derived literals, and the HQ addCredits action validates against its
-- own TS allowlist behind hqGate('manage_credits'). Nothing writes arbitrary
-- user text. A hard value allowlist therefore adds no real safety here and only
-- guarantees this exact breakage on every future action name. Replace it with a
-- sanity CHECK (non-null, sane length) so the DB stays a guardrail without
-- coupling to the evolving set of action labels.
--
-- Existing rows all hold values from the old 4-item allowlist, so ADD CONSTRAINT
-- validates cleanly against current data.

begin;

alter table public.credit_ledger
  drop constraint credit_ledger_type_check;

alter table public.credit_ledger
  add constraint credit_ledger_type_check
  check (type is not null and length(type) between 1 and 64);

commit;
