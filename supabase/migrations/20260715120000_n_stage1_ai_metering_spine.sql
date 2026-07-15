-- WORKSTREAM N Stage 1 — shared AI-drafting metering foundation.
--
-- Two changes, both preparing the credit spine + a usage-audit surface for the
-- Stage 2/3 AI agents (Ticket Assist, Review Agent). No UI, no agent wiring here.
--
-- A1. Re-label credit deduction.
--   The current deduct_credit hardcodes credit_ledger.type = 'signal_deduction'
--   (a Workstream-S signals-era residue) and has ZERO callers today. N is its
--   first consumer, so widen it with a trailing p_reason that flows into the
--   ledger type. Body is preserved EXACTLY otherwise: the atomic oversell-safe
--   UPDATE ... WHERE balance >= amount, the insufficient_credits (P0001) raise,
--   and the ledger INSERT. SECURITY DEFINER + fixed search_path retained.
--
-- A2. ai_usage_log — per-tenant token in/out audit (no such table exists today).
--   Writes are service-role only (no authenticated INSERT policy → fail-closed
--   by construction); the draftAiReply primitive logs usage BEFORE the deduct so
--   a deduct failure still leaves an audit row. reference_id is the ticket/review/
--   lead the draft was for (Manifest #7 — join to the domain object, not raw PII).

begin;

-- ── A1. deduct_credit: add p_reason, write it into credit_ledger.type ──────────

-- DROP the old 3-arg signature (zero callers, no DB dependents) then CREATE the
-- 4-arg version. Types differ, so this is a replace, not an overload.
drop function if exists public.deduct_credit(uuid, integer, uuid);

create function public.deduct_credit(
  org_id   uuid,
  amount   integer,
  ref_id   uuid,
  p_reason text default 'ai_reply'
)
  returns integer
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
declare
  v_new_balance int;
begin
  if amount is null or amount <= 0 then
    raise exception 'amount must be a positive integer' using errcode = '22023';
  end if;

  -- Lock the row so concurrent deductions cannot oversell the balance.
  update public.organization_credits
     set balance    = balance - amount,
         updated_at = now()
   where organization_id = org_id
     and balance >= amount
  returning balance into v_new_balance;

  if v_new_balance is null then
    -- Either the row is missing (shouldn't happen — trigger provisions it)
    -- or balance < amount. Surface as insufficient_credits for the app;
    -- the caller is expected to prompt the tenant to top up.
    raise exception 'insufficient_credits'
      using errcode = 'P0001',
            hint    = format('org=%s requested=%s', org_id, amount);
  end if;

  insert into public.credit_ledger (organization_id, amount, type, reference_id)
  values (org_id, -amount, p_reason, ref_id);

  return v_new_balance;
end;
$function$;

-- Supabase auto-grants EXECUTE to PUBLIC on freshly-created functions. Lock the
-- new signature back down to service_role only (post-SEC-1 posture): trusted
-- server paths call it via the service-role admin client, never anon/authenticated.
revoke execute on function public.deduct_credit(uuid, integer, uuid, text) from public;
revoke execute on function public.deduct_credit(uuid, integer, uuid, text) from anon;
revoke execute on function public.deduct_credit(uuid, integer, uuid, text) from authenticated;
grant  execute on function public.deduct_credit(uuid, integer, uuid, text) to service_role;

-- ── A2. ai_usage_log ──────────────────────────────────────────────────────────

create table public.ai_usage_log (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations(id) on delete cascade,
  action           text        not null,
  model            text        not null,
  tokens_in        integer     not null default 0,
  tokens_out       integer     not null default 0,
  reference_id     uuid,                                    -- the ticket/review/lead (Manifest #7)
  credit_ledger_id uuid        references public.credit_ledger(id),
  created_by       uuid        references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index ai_usage_log_org_created_idx
  on public.ai_usage_log (organization_id, created_at desc);

alter table public.ai_usage_log enable row level security;

-- Tenants read their own org's usage; HQ admins read all. There is deliberately
-- NO authenticated INSERT/UPDATE/DELETE policy — writes come only from the
-- service-role admin client (which bypasses RLS), so the table is fail-closed
-- against tenant-authored rows.
create policy "ai_usage_log: read own org or hq"
  on public.ai_usage_log
  for select
  to authenticated
  using (organization_id = auth_user_org_id() or is_admin_hq());

commit;
