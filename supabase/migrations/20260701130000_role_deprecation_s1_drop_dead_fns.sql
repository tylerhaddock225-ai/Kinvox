-- profiles.role deprecation — STAGE 1: drop the two dead helper functions.
--
-- After K2c-6a retired the last RLS/gate readers of profiles.role, these two
-- functions have ZERO callers — no policy and no other function references them,
-- confirmed live in BOTH sandbox and prod:
--   • auth_user_role()      -- 'select role from profiles where id = auth.uid()'
--   • get_user_role(uuid)   -- 'select role from profiles where id = user_id'
--
-- They are dropped here as Stage 1 of retiring profiles.role. Everything else in
-- the deprecation chain is deliberately LEFT INTACT this stage:
--   • the profiles.role COLUMN, its DEFAULT 'agent', and profiles_role_check
--   • the redeem_organization_claim() role='admin' write
-- Those drop in STAGE 2 — a later migration/sync that runs ONLY AFTER this
-- stage's app changes (which remove every remaining read/write of role) are
-- live on prod. Dropping the column earlier would break invite-acceptance and
-- several pages during the non-atomic deploy/db-push window.

begin;

drop function if exists public.auth_user_role();
drop function if exists public.get_user_role(uuid);

commit;
