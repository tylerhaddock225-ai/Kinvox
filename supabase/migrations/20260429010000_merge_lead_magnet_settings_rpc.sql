-- Kinvox — Atomic merge for organizations.lead_magnet_settings
--
-- Sprint 3 split the editing surface in two: HQ controls slug/enabled/
-- headline, and the Organization controls features (and may control more
-- keys later). Both surfaces target the same jsonb column, so the previous
-- read-modify-write in app code had a theoretical race: a simultaneous
-- HQ + org save could lose one another's writes.
--
-- This RPC performs the merge inside the database with a single UPDATE
-- using the `||` jsonb concat operator. Concurrent calls are serialized by
-- Postgres' row lock; whichever transaction commits second sees the first
-- transaction's value and merges on top of it. No side ever clobbers the
-- other's keys.
--
-- security invoker: RLS on `public.organizations` already restricts UPDATE
-- to HQ admins and tenant admins (see "Admins can update organizations" in
-- the baseline schema). We want the RPC to honor that policy as if the
-- caller had run the UPDATE directly. Both action call sites (HQ and
-- org-side) already pass that policy under their existing auth helpers.

create or replace function public.merge_lead_magnet_settings(
  p_org_id uuid,
  p_patch  jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Defensive: only accept jsonb objects, never arrays/scalars. The `||`
  -- operator on two arrays concatenates rather than merges, which is not
  -- what either call site wants.
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'merge_lead_magnet_settings: patch must be a jsonb object, got %', jsonb_typeof(p_patch);
  end if;

  update public.organizations
     set lead_magnet_settings = coalesce(lead_magnet_settings, '{}'::jsonb) || p_patch
   where id = p_org_id;

  if not found then
    raise exception 'merge_lead_magnet_settings: organization % not found', p_org_id;
  end if;
end;
$$;

comment on function public.merge_lead_magnet_settings(uuid, jsonb) is
  'Atomically merge a partial jsonb patch into organizations.lead_magnet_settings. '
  'Used by HQ (slug/enabled/headline) and org-side (features) editors so '
  'concurrent saves cannot clobber each other. Caller-provided keys overwrite '
  'existing keys; un-mentioned keys are preserved.';

-- Idempotent grants — safe to re-run.
grant execute on function public.merge_lead_magnet_settings(uuid, jsonb)
  to authenticated, service_role;
