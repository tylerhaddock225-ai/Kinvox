-- ============================================================
-- Migration: Promote tyler@kinvoxtech.com to platform_owner.
--
-- Sets public.profiles.system_role = 'platform_owner' for the
-- profile whose id matches the auth.users row with that email.
-- This is what makes public.is_admin_hq() return true for the
-- account, which in turn:
--   • Lets the middleware fall through past the /pending-invite
--     redirect (see src/lib/supabase/middleware.ts).
--   • Makes the root sorting hat route the account to /admin-hq
--     (see src/app/page.tsx).
--
-- Idempotent: a plain UPDATE with a WHERE clause is a no-op if
-- the user does not exist or is already promoted. A NOTICE is
-- raised at the end so the `supabase db push` output makes it
-- obvious whether any rows were affected.
-- ============================================================


-- ── 1. Promote ──────────────────────────────────────────────
update public.profiles as p
   set system_role = 'platform_owner'
  from auth.users as u
 where p.id = u.id
   and lower(u.email) = lower('tyler@kinvoxtech.com');


-- ── 2. Verify ───────────────────────────────────────────────
do $$
declare
  v_hits integer;
begin
  select count(*) into v_hits
    from public.profiles p
    join auth.users     u on u.id = p.id
   where lower(u.email) = lower('tyler@kinvoxtech.com')
     and p.system_role  = 'platform_owner';

  if v_hits = 0 then
    raise notice 'No profile matched tyler@kinvoxtech.com — confirm the auth user exists and a profile row was created by handle_new_user.';
  else
    raise notice 'tyler@kinvoxtech.com is now platform_owner (% row).', v_hits;
  end if;
end $$;
