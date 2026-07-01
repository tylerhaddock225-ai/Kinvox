-- profiles.role deprecation — STAGE 2 (FINAL): drop the column.
--
-- Stage 1 (live on prod, merge 6d12283) removed every app read/write/type of
-- profiles.role and dropped auth_user_role() + get_user_role(). Reconfirmed
-- against live sandbox immediately before writing this: ZERO policies read role,
-- NO function reads it (only redeem_organization_claim WRITES role='admin'), the
-- only column dependencies are its DEFAULT + profiles_role_check, and NO app code
-- references the column. It is fully authority-dead (HQ authority = system_role;
-- tenant authority = the permission bag via role_id).
--
-- IRREVERSIBLE (DROP COLUMN). Order matters: rewrite redeem to stop referencing
-- the column BEFORE dropping it.

begin;

-- ── STEP 1: rewrite redeem_organization_claim to stop writing role ──────────
-- Identical to the live definition EXCEPT the profiles UPDATE no longer sets
-- role='admin' (the column is dropped below). Every other line — signature,
-- SECURITY DEFINER, search_path, token verification/consumption, owner_id swap,
-- membership attach, updated_at, claim consumption, return — is preserved
-- verbatim. CREATE OR REPLACE preserves the existing EXECUTE grants.
create or replace function public.redeem_organization_claim(claim_token_raw text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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
  -- explicitly - the SECURITY DEFINER search_path excludes it.
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

  -- Attach the redeeming user to the org. role_id is left alone (HQ/custom
  -- role tables are orthogonal). The legacy 'role' text column is no longer
  -- set here - it is dropped in STEP 2 of this migration; tenant authority is
  -- the permission bag resolved via role_id.
  update public.profiles
     set organization_id = v_claim.organization_id,
         updated_at = now()
   where id = v_uid;

  update public.organization_claims
     set claimed_at = now()
   where id = v_claim.id;

  return v_claim.organization_id;
end;
$$;

-- ── STEP 2: drop the column and its dependents ──────────────────────────────
-- The DROP COLUMN would cascade the DEFAULT + CHECK anyway; they are dropped
-- explicitly first for clarity. DROP COLUMN (no CASCADE) is itself the safety
-- net: it errors if any un-audited object still depends on the column. The
-- reconfirm above proved only the DEFAULT + profiles_role_check depend on it.
alter table public.profiles alter column role drop default;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop column role;

-- This completes the profiles.role deprecation (the K2c arc). HQ authority is
-- system_role; tenant authority is the permission bag via role_id. The legacy
-- text role column is fully retired.

commit;
