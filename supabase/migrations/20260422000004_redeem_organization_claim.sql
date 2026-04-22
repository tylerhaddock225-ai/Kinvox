-- Redeem an organization claim: the merchant arrives with a raw token,
-- we verify it matches a live unclaimed row, then transfer ownership
-- away from the placeholder HQ admin that approve_organization_application
-- stamped in as a stand-in owner.
--
-- Side effects on success (all in one transaction):
--   1. organizations.owner_id ← auth.uid()
--   2. profiles.organization_id ← claim.organization_id
--      profiles.role            ← 'admin'            (tenant admin from login #1)
--   3. organization_claims.claimed_at ← now()

create or replace function public.redeem_organization_claim(claim_token_raw text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_hash  text;
  v_claim public.organization_claims%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- sha256(raw) matches what the generator persisted. pgcrypto ships in
  -- the extensions schema per the baseline migration, so reach into it
  -- explicitly — the SECURITY DEFINER search_path excludes it.
  v_hash := encode(extensions.digest(claim_token_raw, 'sha256'), 'hex');

  select * into v_claim
  from public.organization_claims
  where token_hash = v_hash
    and claimed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'claim invalid, expired, or already redeemed'
      using errcode = 'P0002';
  end if;

  -- Swap placeholder HQ admin out of owner_id. The original approve
  -- RPC stamped the reviewing admin as owner so the NOT NULL FK would
  -- hold; this is where that temporary assignment finally ends.
  update public.organizations
     set owner_id = v_uid,
         updated_at = now()
   where id = v_claim.organization_id;

  -- Attach the redeeming user to the org as its tenant admin. Set the
  -- legacy 'role' text column (baseline-era permissions); role_id is
  -- left alone since HQ/custom role tables are orthogonal.
  update public.profiles
     set organization_id = v_claim.organization_id,
         role = 'admin',
         updated_at = now()
   where id = v_uid;

  update public.organization_claims
     set claimed_at = now()
   where id = v_claim.id;

  return v_claim.organization_id;
end;
$$;

revoke all on function public.redeem_organization_claim(text) from public;
grant execute on function public.redeem_organization_claim(text) to authenticated;
