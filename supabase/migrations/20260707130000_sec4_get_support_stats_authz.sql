-- SEC-4 (audit M1): public.get_support_stats(p_org_id uuid) trusted its p_org_id argument with NO
-- caller authorization and was EXECUTE-granted to anon/public (Supabase default blanket grant) →
-- any holder of the public anon key could call /rest/v1/rpc/get_support_stats with an arbitrary org
-- UUID and read that org's ticket stats (open/closed/avg-resolution) — an unauthenticated
-- cross-tenant information disclosure.
--
-- Fix (three parts, semantics of the stats query UNCHANGED — verbatim from the live definition):
--   1. Revoke EXECUTE from public + anon (the sole caller is the authenticated dashboard SSR client,
--      src/app/(app)/(dashboard)/[orgSlug]/page.tsx — DB role `authenticated`, which is kept).
--   2. Convert LANGUAGE sql → plpgsql (a conditional RAISE is plpgsql-only) and add a fail-CLOSED
--      internal guard: allow when the caller is HQ (is_admin_hq() — also true for an impersonating HQ
--      admin, since impersonation is app-layer and auth.uid() stays the real HQ admin at the DB) OR the
--      caller belongs to the requested org (p_org_id = auth_user_org_id()). Matches the guarded pattern
--      of approve_organization_application / redeem_organization_claim (plpgsql + errcode 42501).
--   3. Pin search_path = public, pg_temp (SEC-1 M4 hardening + linter parity).
--
-- CRITICAL — the allow-predicate MUST be wrapped in coalesce(..., false). The raw form
--   `if not (is_admin_hq() or p_org_id = auth_user_org_id())`
-- FAILS OPEN for an org-less authenticated principal (profiles.organization_id IS NULL AND
-- system_role IS NULL): under Postgres three-valued logic `false OR (uuid = NULL)` is NULL, `NOT NULL`
-- is NULL, and a plpgsql `IF <NULL> THEN` does NOT fire — so execution falls through to the queries
-- (ALLOW). coalesce(..., false) forces that NULL to false so the guard raises (DENY). Verified in
-- sandbox: a live profile matches this class, and the raw predicate returned NULL while the
-- coalesce-wrapped predicate returned true (→ raise).

create or replace function public.get_support_stats(p_org_id uuid)
returns table(open_count bigint, closed_week bigint, avg_hours numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  -- Fail-closed authorization: HQ (incl. impersonating) OR caller belongs to the requested org.
  if not coalesce(public.is_admin_hq() or p_org_id = public.auth_user_org_id(), false) then
    raise exception 'get_support_stats: access denied' using errcode = '42501';
  end if;

  -- Stats query — copied verbatim from the prior LANGUAGE sql definition; semantics unchanged.
  return query
    select
      -- All non-closed, non-deleted tickets
      (
        select count(*)
        from   public.tickets
        where  organization_id = p_org_id
          and  status         != 'closed'
          and  deleted_at      is null
      ) as open_count,

      -- Tickets closed in the last 7 days
      (
        select count(*)
        from   public.tickets
        where  organization_id = p_org_id
          and  status          = 'closed'
          and  updated_at     >= now() - interval '7 days'
      ) as closed_week,

      -- Average resolution time (resolved_at - created_at) in hours, 1 decimal
      (
        select round(
          extract(epoch from avg(resolved_at - created_at)) / 3600.0,
          1
        )
        from   public.tickets
        where  organization_id = p_org_id
          and  resolved_at     is not null
          and  status          in ('resolved', 'closed')
      ) as avg_hours;
end;
$function$;

-- Close the /rpc hole: drop the default/public + anon EXECUTE; keep the authenticated app path.
revoke execute on function public.get_support_stats(p_org_id uuid) from public, anon;
grant  execute on function public.get_support_stats(p_org_id uuid) to authenticated;
