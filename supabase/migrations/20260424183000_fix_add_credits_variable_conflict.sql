-- Fix: add_credits() had an ambiguous "balance" reference in the UPDATE's
-- RETURNING clause — the OUT parameter `balance` shadowed the column of the
-- same name on public.organization_credits, and Postgres refused to guess.
--
-- The tightest repair is the plpgsql pragma `#variable_conflict use_column`,
-- which tells the planner to prefer column references when a name collides
-- with a variable or OUT parameter inside SQL statements. No signature change,
-- so no callers need updating.

create or replace function public.add_credits(
  p_org_id  uuid,
  p_amount  int,
  p_ext_ref text
) returns table(balance int, duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
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

  insert into public.credit_ledger (organization_id, amount, type, external_reference)
  values (p_org_id, p_amount, 'purchase', p_ext_ref)
  on conflict (external_reference) where external_reference is not null do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
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
    insert into public.organization_credits (organization_id, balance)
    values (p_org_id, p_amount)
    returning balance into v_balance;
  end if;

  return query select v_balance, false;
end;
$$;

revoke all     on function public.add_credits(uuid, int, text) from public;
grant  execute on function public.add_credits(uuid, int, text) to service_role;
