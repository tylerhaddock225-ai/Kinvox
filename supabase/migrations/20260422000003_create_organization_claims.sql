-- Merchant claim flow. The HQ generates a short-lived, single-use token
-- tied to an org + delivery email; the merchant redeems it to take
-- ownership. Mirrors the password_reset_tokens shape (hashed token,
-- expires_at, used_at/claimed_at) so we get the same security posture:
-- the raw token is only ever in the outbound email, the DB stores
-- sha256(token).

create table if not exists public.organization_claims (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash      text not null unique,
  email           text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  claimed_at      timestamptz
);

create index if not exists organization_claims_org_idx
  on public.organization_claims (organization_id);

-- Redemption path queries by hash; every unspent claim lookup hits
-- this index. Partial so the index stays lean.
create index if not exists organization_claims_unclaimed_idx
  on public.organization_claims (token_hash)
  where claimed_at is null;

alter table public.organization_claims enable row level security;

-- HQ staff (any platform_* system_role) can insert new claims and read
-- all rows for administration. No policy for anon/tenant roles — public
-- redemption goes through a SECURITY DEFINER RPC that validates the
-- token against token_hash without ever exposing the row.
create policy "organization_claims: hq read"
  on public.organization_claims
  for select
  to authenticated
  using (public.is_admin_hq());

create policy "organization_claims: hq insert"
  on public.organization_claims
  for insert
  to authenticated
  with check (public.is_admin_hq());

-- HQ can also revoke / tidy up old rows (e.g. invalidate before reissue).
create policy "organization_claims: hq update"
  on public.organization_claims
  for update
  to authenticated
  using (public.is_admin_hq())
  with check (public.is_admin_hq());

create policy "organization_claims: hq delete"
  on public.organization_claims
  for delete
  to authenticated
  using (public.is_admin_hq());

grant select, insert, update, delete on table public.organization_claims
  to authenticated;
grant all on table public.organization_claims to service_role;
