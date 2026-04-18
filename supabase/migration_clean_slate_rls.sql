-- ================================================================
-- Kinvox — CLEAN SLATE RLS Migration
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
--
-- This migration is safe to run multiple times (idempotent).
-- It dynamically drops EVERY policy on profiles and organizations
-- regardless of name, then rebuilds with clean, non-recursive
-- policies and hardened security-definer helpers.
-- ================================================================


-- ── STEP 1: Drop ALL policies on both tables dynamically ────────
-- This bypasses the name-matching problem that caused previous
-- migrations to silently leave stale recursive policies behind.

do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'organizations', 'leads', 'tickets')
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      r.policyname,
      (select tablename from pg_policies
       where schemaname = 'public' and policyname = r.policyname
       limit 1)
    );
  end loop;
end $$;


-- ── STEP 2: Drop and recreate security-definer helpers ──────────
-- SECURITY DEFINER means these run as the function owner (postgres),
-- completely bypassing RLS. They cannot recurse.

drop function if exists public.auth_user_org_id();
drop function if exists public.auth_user_role();

create function public.auth_user_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid()
$$;

create function public.auth_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;


-- ── STEP 3: Confirm RLS is enabled on all tables ─────────────────

alter table public.profiles      enable row level security;
alter table public.organizations enable row level security;
alter table public.leads         enable row level security;
alter table public.tickets       enable row level security;


-- ── STEP 4: PROFILES policies ────────────────────────────────────
-- UPDATE only uses `id = auth.uid()` — zero subqueries, zero
-- function calls, zero chance of recursion.

create policy "profiles: select own"
  on public.profiles
  for select
  using (id = auth.uid());

create policy "profiles: select same org"
  on public.profiles
  for select
  using (organization_id = public.auth_user_org_id());

create policy "profiles: update own"
  on public.profiles
  for update
  using    (id = auth.uid())
  with check (id = auth.uid());


-- ── STEP 5: ORGANIZATIONS policies ───────────────────────────────

-- New users can create their own org during onboarding.
create policy "organizations: insert as owner"
  on public.organizations
  for insert
  with check (owner_id = auth.uid());

-- Users can see orgs they belong to OR orgs they own.
-- Two separate conditions joined so that during onboarding
-- (before profile.organization_id is set) the owner can still
-- read back the row they just created.
create policy "organizations: select member or owner"
  on public.organizations
  for select
  using (
    id = public.auth_user_org_id()   -- after onboarding (member)
    or owner_id = auth.uid()          -- during onboarding (owner)
  );

-- Only admins can update their org's details.
create policy "organizations: update if admin"
  on public.organizations
  for update
  using (
    id = public.auth_user_org_id()
    and public.auth_user_role() = 'admin'
  );


-- ── STEP 6: LEADS policies ───────────────────────────────────────

create policy "leads: select own org"
  on public.leads for select
  using (organization_id = public.auth_user_org_id());

create policy "leads: insert own org"
  on public.leads for insert
  with check (organization_id = public.auth_user_org_id());

create policy "leads: update own org"
  on public.leads for update
  using (organization_id = public.auth_user_org_id());

create policy "leads: delete admin only"
  on public.leads for delete
  using (
    organization_id = public.auth_user_org_id()
    and public.auth_user_role() = 'admin'
  );


-- ── STEP 7: TICKETS policies ─────────────────────────────────────

create policy "tickets: select own org"
  on public.tickets for select
  using (organization_id = public.auth_user_org_id());

create policy "tickets: insert own org"
  on public.tickets for insert
  with check (organization_id = public.auth_user_org_id());

create policy "tickets: update own org"
  on public.tickets for update
  using (organization_id = public.auth_user_org_id());

create policy "tickets: delete admin only"
  on public.tickets for delete
  using (
    organization_id = public.auth_user_org_id()
    and public.auth_user_role() = 'admin'
  );


-- ── STEP 8: Verify — list all active policies ────────────────────
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'organizations', 'leads', 'tickets')
order by tablename, cmd;
