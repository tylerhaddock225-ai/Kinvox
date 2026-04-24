-- Kinvox — Billing Infrastructure (Sandbox project ntwimeqxyyvjyrisqofl)
--
-- Adds top-up support to the existing credit ledger:
--   * credit_ledger.external_reference — idempotency key for inbound payments
--     (e.g. Stripe Checkout Session id "cs_..."). Unique only when non-null so
--     existing signal_deduction rows (which have no external id) are unaffected.
--   * add_credits(org_id, amount, ext_ref) — atomic counterpart to deduct_credit.
--     One statement path: insert ledger row → on duplicate ext_ref, no-op (dup
--     event) → otherwise increment the balance. Wrapped SECURITY DEFINER so the
--     Stripe webhook (service_role) is the only caller, matching the deduct path.

alter table public.credit_ledger
  add column if not exists external_reference text;

comment on column public.credit_ledger.external_reference is
  'External idempotency key — typically a Stripe Checkout Session id (cs_...) for purchase rows.';

-- Partial unique: NULL rows (existing deductions) remain unaffected; only
-- non-null ext_refs must be unique. Matches the ON CONFLICT predicate below.
create unique index if not exists credit_ledger_external_reference_key
  on public.credit_ledger(external_reference)
  where external_reference is not null;


-- ─────────────────────────────────────────────────────────────
-- add_credits(org_id, amount, ext_ref) → (balance int, duplicate bool)
--
--   duplicate=true means the ext_ref was already processed — caller
--   should treat as success (webhook replay / Stripe retry).
-- ─────────────────────────────────────────────────────────────

create or replace function public.add_credits(
  p_org_id  uuid,
  p_amount  int,
  p_ext_ref text
) returns table(balance int, duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted int;
  v_balance  int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be a positive integer' using errcode = '22023';
  end if;
  if p_ext_ref is null or length(p_ext_ref) = 0 then
    raise exception 'external_reference is required' using errcode = '22023';
  end if;

  -- Append the ledger row first. The unique index on external_reference makes
  -- this the idempotency gate: a duplicate webhook fires a no-op insert.
  insert into public.credit_ledger (organization_id, amount, type, external_reference)
  values (p_org_id, p_amount, 'purchase', p_ext_ref)
  on conflict (external_reference) where external_reference is not null do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    -- Duplicate. Return the current balance unchanged so the caller can
    -- still confirm 200 OK to Stripe without re-billing the org.
    select oc.balance into v_balance
      from public.organization_credits oc
     where oc.organization_id = p_org_id;
    return query select coalesce(v_balance, 0), true;
    return;
  end if;

  update public.organization_credits
     set balance    = balance + p_amount,
         updated_at = now()
   where organization_id = p_org_id
  returning balance into v_balance;

  if v_balance is null then
    -- organization_credits row should always exist (provisioned by trigger)
    -- but if it doesn't, self-heal rather than rolling back the ledger row.
    insert into public.organization_credits (organization_id, balance)
    values (p_org_id, p_amount)
    returning balance into v_balance;
  end if;

  return query select v_balance, false;
end;
$$;

revoke all     on function public.add_credits(uuid, int, text) from public;
grant  execute on function public.add_credits(uuid, int, text) to service_role;
