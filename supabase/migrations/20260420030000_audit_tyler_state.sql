-- ============================================================
-- Diagnostic migration: audit the tyler@kinvoxtech.com account.
--
-- Emits NOTICEs at every step so `supabase db push` output shows
-- exactly which layer is (or isn't) working:
--
--   1. auth.users match for the email (case-insensitive).
--   2. Exact-case email, id, created_at on the auth row.
--   3. public.profiles row state (system_role, organization_id).
--   4. Defensive re-promotion (case-insensitive).
--   5. Post-update state.
--   6. Replay of the is_admin_hq() predicate against the row.
--
-- This migration only READS + idempotently updates one row; safe
-- to re-run. Any NOTICE starting with "⚠" points at the break.
-- ============================================================

do $$
declare
  v_hits_ci    integer;
  v_hits_exact integer;
  v_uid        uuid;
  v_email      text;
  v_confirmed  timestamptz;
  v_role       text;
  v_sys_role   text;
  v_org_id     uuid;
  v_profile_ct integer;
  v_predicate  boolean;
begin
  -- ── 1. auth.users existence check (case-insensitive) ──
  select count(*) into v_hits_ci
    from auth.users
   where lower(email) = 'tyler@kinvoxtech.com';

  select count(*) into v_hits_exact
    from auth.users
   where email = 'tyler@kinvoxtech.com';

  raise notice '[1] auth.users case-insensitive hits: % | exact-case hits: %',
    v_hits_ci, v_hits_exact;

  if v_hits_ci = 0 then
    raise notice '⚠ auth.users has no row for this email. The account was never created — check the signup/invite flow.';
    return;
  end if;

  -- ── 2. Pull the canonical row ──
  select id, email, email_confirmed_at
    into v_uid, v_email, v_confirmed
    from auth.users
   where lower(email) = 'tyler@kinvoxtech.com'
   limit 1;

  raise notice '[2] auth.users: id=% email=% confirmed_at=%',
    v_uid, v_email, v_confirmed;

  if v_email <> lower(v_email) then
    raise notice '⚠ The stored email is mixed-case (%). Any SQL using exact-case "tyler@kinvoxtech.com" will MISS this row. Use lower(email).', v_email;
  end if;

  -- ── 3. profile row state ──
  select count(*) into v_profile_ct
    from public.profiles
   where id = v_uid;

  raise notice '[3] public.profiles row count for uid: %', v_profile_ct;

  if v_profile_ct = 0 then
    raise notice '⚠ No profile row exists for uid %. The handle_new_user trigger did not fire, or the profile was deleted.', v_uid;
    return;
  end if;

  select role, system_role, organization_id
    into v_role, v_sys_role, v_org_id
    from public.profiles
   where id = v_uid;

  raise notice '[3b] BEFORE: role=% system_role=% organization_id=%',
    v_role, coalesce(v_sys_role, '<null>'), coalesce(v_org_id::text, '<null>');

  -- ── 4. Defensive re-promotion (case-insensitive) ──
  update public.profiles
     set system_role = 'platform_owner'
   where id = v_uid;

  -- ── 5. Post-update state ──
  select role, system_role, organization_id
    into v_role, v_sys_role, v_org_id
    from public.profiles
   where id = v_uid;

  raise notice '[5] AFTER : role=% system_role=% organization_id=%',
    v_role, coalesce(v_sys_role, '<null>'), coalesce(v_org_id::text, '<null>');

  -- ── 6. Replay is_admin_hq()'s predicate directly ──
  -- (Cannot call is_admin_hq() here because auth.uid() is null in
  -- a migration context; but we can re-evaluate its body.)
  select exists (
    select 1 from public.profiles
     where id = v_uid and system_role is not null
  ) into v_predicate;

  raise notice '[6] is_admin_hq()-equivalent predicate for uid % => %',
    v_uid, v_predicate;

  if not v_predicate then
    raise notice '⚠ Predicate is FALSE. The profile row exists but system_role is still null after UPDATE — that is a DB-level conflict you need to dig into.';
  else
    raise notice '✓ Predicate is TRUE. If the app still redirects to /pending-invite, the problem is client-side (stale session/cookie) or server-side render cache — sign out fully and back in.';
  end if;
end $$;
