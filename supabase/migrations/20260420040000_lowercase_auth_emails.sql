-- ============================================================
-- Migration: Normalise existing auth.users.email rows to lowercase.
--
-- Why
--   Supabase GoTrue already lowercases emails at signup, but
--   anything that pre-dates that (seeded rows, direct inserts,
--   legacy imports) can linger in mixed case. That makes
--   email-keyed lookups with exact-case WHERE clauses silently
--   miss the row.
--
-- Scope note — no auth-schema DDL
--   An earlier version of this migration also tried to install a
--   BEFORE INSERT/UPDATE trigger on auth.users to future-proof
--   the normalisation. Supabase Cloud denies CREATE FUNCTION in
--   the auth schema (permission denied, SQLSTATE 42501), which
--   rolled the whole transaction back. Future normalisation is
--   now enforced at the application layer instead:
--     • src/app/(auth)/actions.ts → login()
--     • src/app/admin/onboarding/actions.ts → inviteOrgOwner()
--     • src/app/(dashboard)/settings/team/actions.ts → inviteMember()
--     • src/app/api/auth/reset-password/route.ts → POST (already lowercased)
--
-- Idempotent: the collision guard aborts before any write if
-- lowering would break uniqueness, and the UPDATE is gated on
-- email <> lower(email).
-- ============================================================


-- ── 1. Collision guard ─────────────────────────────────────
-- If two rows already reduce to the same lowercase form we must
-- NOT proceed — the unique index on LOWER(email) would fail mid-
-- update, leaving the table half-normalised.
do $$
declare
  v_collisions integer;
begin
  select count(*) into v_collisions
    from (
      select lower(email) as e
        from auth.users
       where email is not null
       group by lower(email)
      having count(*) > 1
    ) d;

  if v_collisions > 0 then
    raise exception
      'Aborting: % duplicate email(s) detected in auth.users when lowercased. Resolve manually before re-running.',
      v_collisions;
  end if;
end $$;


-- ── 2. One-shot lowercase of existing rows ─────────────────
update auth.users
   set email = lower(email)
 where email is not null
   and email <> lower(email);


-- ── 3. Verification ────────────────────────────────────────
do $$
declare
  v_remaining integer;
begin
  select count(*) into v_remaining
    from auth.users
   where email is not null
     and email <> lower(email);

  if v_remaining = 0 then
    raise notice 'auth.users.email is fully lowercase.';
  else
    raise notice '⚠ % row(s) still non-lowercase — investigate.', v_remaining;
  end if;
end $$;
