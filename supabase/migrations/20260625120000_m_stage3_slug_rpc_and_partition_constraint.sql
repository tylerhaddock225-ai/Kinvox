-- (A) Slug-resolution RPC. SECURITY DEFINER + pinned search_path so it reads
-- organizations by a single unambiguous id lookup — no PostgREST embed, no dual-FK
-- ambiguity (PGRST201). Returns the slug for a given org id, or NULL if not found.
create or replace function public.resolve_org_slug(p_org_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select slug from public.organizations where id = p_org_id;
$$;

revoke all on function public.resolve_org_slug(uuid) from public;
grant execute on function public.resolve_org_slug(uuid) to authenticated;

-- (B) Partition constraint: forbid ONLY the dual-positive state (a profile that is
-- both HQ and a tenant member — the exact anomaly Workstream M removed). Permits
-- dual-null (detached/pending users) and inbox bots and all single-positive states.
-- NOT VALID then VALIDATE so the add is non-blocking and surfaces any violator
-- explicitly rather than silently failing.
alter table public.profiles
  add constraint profiles_no_dual_positive
  check (not (system_role is not null and organization_id is not null))
  not valid;

alter table public.profiles validate constraint profiles_no_dual_positive;
