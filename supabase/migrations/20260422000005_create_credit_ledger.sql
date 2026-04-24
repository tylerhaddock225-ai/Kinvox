-- Kinvox — Credit Ledger & PPS Billing (Sandbox project ntwimeqxyyvjyrisqofl)
--
-- Model:
--   * organization_credits  — one row per org, the live balance and auto-top-up prefs.
--   * credit_ledger         — append-only audit log of every +/- balance movement.
--
-- Writes flow through public.deduct_credit() (SECURITY DEFINER). Tenants can
-- only SELECT their own rows. Ledger mutations are restricted to service_role
-- and HQ admins (is_admin_hq()), matching the resolveImpersonation() model:
-- an HQ admin impersonating a tenant still sees/acts on that tenant's row
-- because is_admin_hq() shortcuts the policy predicates.
--
-- Amounts are whole-number "signals" (int). No fractional credits.


-- ─────────────────────────────────────────────────────────────
-- 1. organization_credits  (balance + top-up config, one row per org)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.organization_credits (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null unique
                                   references public.organizations(id) on delete cascade,
  balance              int         not null default 0
                                   check (balance >= 0),
  auto_top_up_enabled  boolean     not null default false,
  top_up_threshold     int         check (top_up_threshold is null or top_up_threshold >= 0),
  top_up_amount        int         check (top_up_amount   is null or top_up_amount   >  0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger set_organization_credits_updated_at
  before update on public.organization_credits
  for each row execute function public.set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 2. credit_ledger  (append-only audit trail)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.credit_ledger (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null
                              references public.organizations(id) on delete cascade,
  amount          int         not null check (amount <> 0),
  type            text        not null
                              check (type in ('signal_deduction', 'purchase', 'refund', 'adjustment')),
  reference_id    uuid,
  created_at      timestamptz not null default now()
);

create index if not exists credit_ledger_org_created_idx
  on public.credit_ledger(organization_id, created_at desc);

create index if not exists credit_ledger_reference_idx
  on public.credit_ledger(reference_id)
  where reference_id is not null;


-- ─────────────────────────────────────────────────────────────
-- 3. Auto-provision a credits row when a new org is created
-- ─────────────────────────────────────────────────────────────

create or replace function public.ensure_organization_credits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.organization_credits (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_organization_created_provision_credits on public.organizations;
create trigger on_organization_created_provision_credits
  after insert on public.organizations
  for each row execute function public.ensure_organization_credits();

-- Backfill: every existing org gets a zero-balance row.
insert into public.organization_credits (organization_id)
select o.id
  from public.organizations o
  left join public.organization_credits c on c.organization_id = o.id
 where c.organization_id is null;


-- ─────────────────────────────────────────────────────────────
-- 4. deduct_credit(org_id, amount, ref_id)
--
--    Atomic: locks the credit row, checks balance, either commits a
--    decrement + ledger row or raises 'insufficient_credits' (SQLSTATE
--    P0001) for the app to catch and route into the Top-Up flow.
-- ─────────────────────────────────────────────────────────────

create or replace function public.deduct_credit(
  org_id uuid,
  amount int,
  ref_id uuid
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  values (org_id, -amount, 'signal_deduction', ref_id);

  return v_new_balance;
end;
$$;

-- Only the service role (AI signal worker, HQ-side route handlers) may
-- invoke this. Tenants never deduct their own credits from the browser.
revoke all on function public.deduct_credit(uuid, int, uuid) from public;
grant execute on function public.deduct_credit(uuid, int, uuid) to service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. RLS — tenants read-only; writes gated to HQ / service_role
-- ─────────────────────────────────────────────────────────────

alter table public.organization_credits enable row level security;
alter table public.credit_ledger        enable row level security;

-- organization_credits: SELECT for own-org members and HQ admins
-- (the is_admin_hq() branch also covers resolveImpersonation, since
-- an impersonating admin still evaluates is_admin_hq() = true).
create policy "credits: select own org or hq"
  on public.organization_credits for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

-- organization_credits: HQ admins may update top-up config / manual adjust.
-- Tenants cannot update their own balance directly — changes must flow
-- through deduct_credit() / service_role writes.
create policy "credits: hq update"
  on public.organization_credits for update
  to authenticated
  using (public.is_admin_hq())
  with check (public.is_admin_hq());

-- credit_ledger: SELECT for own-org members and HQ admins.
create policy "ledger: select own org or hq"
  on public.credit_ledger for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

-- credit_ledger: HQ admins may insert (manual purchase/refund/adjustment
-- entries). The service_role bypasses RLS entirely, so the AI worker and
-- deduct_credit() are unaffected by this policy.
create policy "ledger: hq insert"
  on public.credit_ledger for insert
  to authenticated
  with check (public.is_admin_hq());

-- No UPDATE or DELETE policies on credit_ledger — it is append-only.


-- ─────────────────────────────────────────────────────────────
-- 6. Grants (RLS remains the enforcement boundary; follows baseline pattern)
-- ─────────────────────────────────────────────────────────────

grant select                         on public.organization_credits to authenticated;
grant select, update                 on public.organization_credits to authenticated;
grant all                            on public.organization_credits to service_role;

grant select                         on public.credit_ledger to authenticated;
grant insert                         on public.credit_ledger to authenticated;
grant all                            on public.credit_ledger to service_role;
