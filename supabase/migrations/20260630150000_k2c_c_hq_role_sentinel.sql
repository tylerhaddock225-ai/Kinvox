-- Workstream K2c Stage C — honest 'hq' role sentinel (closes K2c).
--
-- HQ users have borrowed role='admin' since J2: profiles.role is NOT NULL and was
-- constrained to ('admin','agent','viewer'), so the HQ redeem stamped the
-- constraint-legal 'admin'. Real HQ authority keys on system_role (+ the HQ
-- permission bag), never on profiles.role — so 'admin' on an HQ row was a
-- meaningless borrow. This adds a dedicated 'hq' value and flips existing HQ users
-- onto it, making the sentinel honest.
--
-- Tenant rows (admin/agent/viewer) are unchanged; the column default stays 'agent'.
-- Nothing reads profiles.role for HQ rows (HQ gating is system_role-based), so the
-- flip is behavior-neutral.

begin;

-- 1) Allow 'hq' in the role CHECK. Postgres has no ALTER CONSTRAINT for CHECKs, so
--    DROP + re-add, matching the live definition exactly and only appending 'hq'.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin'::text, 'agent'::text, 'viewer'::text, 'hq'::text]));

-- 2) Flip existing HQ users onto the honest sentinel. Scoped to HQ rows
--    (system_role IS NOT NULL) — tenant admins keep role='admin'. The new
--    constraint already permits both 'admin' and 'hq', so no intermediate row
--    violates during the flip.
update public.profiles
   set role = 'hq'
 where system_role is not null and role = 'admin';

commit;
