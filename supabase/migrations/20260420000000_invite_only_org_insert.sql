-- ============================================================
-- Migration: Lock organization creation to invite-only paths.
--
-- Removes every INSERT pathway on public.organizations that is
-- reachable by the anon or authenticated roles. After this,
-- only the two authorised entry points remain:
--
--   A) Admin HQ — uses SUPABASE_SERVICE_ROLE_KEY, which bypasses
--      RLS entirely.
--   B) Postmark invite acceptance — the org row is pre-created
--      by Admin HQ, and the invited user is linked to it via
--      public.finalize_invited_org_membership(), a SECURITY
--      DEFINER helper that reads the invite UUID stamped into
--      auth.users.raw_user_meta_data.invited_to_org.
--
-- RLS remains enabled on public.organizations; dropping the
-- INSERT policy is what closes the door.
-- ============================================================


-- ── 1. Drop every public INSERT/owner-based policy ──────────
drop policy if exists "organizations: insert as owner" on public.organizations;
drop policy if exists "organizations: read if owner"   on public.organizations;

alter table public.organizations enable row level security;


-- ── 2. Invite-finalisation RPC ──────────────────────────────
-- Links the calling user's profile to the org UUID that Admin HQ
-- stamped into their auth.users.raw_user_meta_data.invited_to_org
-- at invite time. Runs as the function owner so it can read the
-- auth schema and update the profile without tripping RLS.
--
-- Returns the organization slug on success so the caller can
-- redirect to the dashboard. Raises on any validation failure.
create or replace function public.finalize_invited_org_membership()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_invited_to uuid;
  v_slug       text;
  v_current    uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select (raw_user_meta_data ->> 'invited_to_org')::uuid
    into v_invited_to
    from auth.users
   where id = v_user_id;

  if v_invited_to is null then
    raise exception 'No invitation found for this account';
  end if;

  select slug into v_slug
    from public.organizations
   where id = v_invited_to
     and deleted_at is null;

  if v_slug is null then
    raise exception 'Invited organization no longer exists';
  end if;

  select organization_id into v_current
    from public.profiles
   where id = v_user_id;

  -- Idempotent: re-accepting the same invite just returns the slug.
  if v_current = v_invited_to then
    return v_slug;
  end if;

  if v_current is not null then
    raise exception 'User already belongs to a different organization';
  end if;

  update public.profiles
     set organization_id = v_invited_to
   where id = v_user_id;

  return v_slug;
end
$$;

revoke all    on function public.finalize_invited_org_membership() from public, anon;
grant execute on function public.finalize_invited_org_membership() to authenticated;


-- ── 3. Read-only "do I have a pending invite?" helper ───────
create or replace function public.current_user_invited_org()
returns table (org_id uuid, org_name text, org_slug text)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug
    from auth.users u
    join public.organizations o
      on o.id = (u.raw_user_meta_data ->> 'invited_to_org')::uuid
     and o.deleted_at is null
   where u.id = auth.uid()
$$;

revoke all    on function public.current_user_invited_org() from public, anon;
grant execute on function public.current_user_invited_org() to authenticated;


-- ── 4. Verification ─────────────────────────────────────────
-- After running, this should return zero rows — no INSERT policy
-- remains on public.organizations:
--   select policyname from pg_policies
--    where schemaname = 'public'
--      and tablename  = 'organizations'
--      and cmd        = 'INSERT';
