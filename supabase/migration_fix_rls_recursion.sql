-- ============================================================
-- Kinvox — Fix: Infinite RLS Recursion on profiles table
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================
-- Root cause: policies on `profiles` that SELECT FROM `profiles`
-- cause PostgreSQL to recurse infinitely when evaluating rows.
--
-- Fix: two SECURITY DEFINER helper functions that read the
-- current user's org_id and role directly (bypassing RLS),
-- used by ALL policies across all four tables.
-- ============================================================


-- ── 1. SECURITY DEFINER helpers ─────────────────────────────
-- These run as the function owner (postgres), so they bypass
-- RLS and cannot recurse.

create or replace function public.auth_user_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid()
$$;

create or replace function public.auth_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;


-- ── 2. DROP all existing policies ───────────────────────────

drop policy if exists "Users can view own profile"       on public.profiles;
drop policy if exists "Admins can view org profiles"     on public.profiles;
drop policy if exists "Users can update own profile"     on public.profiles;

drop policy if exists "Members can view own organization"  on public.organizations;
drop policy if exists "Admins can update own organization" on public.organizations;

drop policy if exists "Org members can view leads"    on public.leads;
drop policy if exists "Org members can insert leads"  on public.leads;
drop policy if exists "Org members can update leads"  on public.leads;
drop policy if exists "Admins can delete leads"       on public.leads;

drop policy if exists "Org members can view tickets"    on public.tickets;
drop policy if exists "Org members can insert tickets"  on public.tickets;
drop policy if exists "Org members can update tickets"  on public.tickets;
drop policy if exists "Admins can delete tickets"       on public.tickets;


-- ── 3. PROFILES policies (no self-references) ───────────────

-- Any user can read their own row — no subquery needed.
create policy "profiles: read own"
  on public.profiles for select
  using (id = auth.uid());

-- Any user in the same org can read other profiles.
-- Uses helper function — no recursion.
create policy "profiles: read same org"
  on public.profiles for select
  using (organization_id = public.auth_user_org_id());

-- Users can update only their own row.
create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());


-- ── 4. ORGANIZATIONS policies ────────────────────────────────

-- Members see their own org.
create policy "organizations: read own"
  on public.organizations for select
  using (id = public.auth_user_org_id());

-- Authenticated users can create an org where they are the owner.
-- This unblocks the onboarding INSERT.
create policy "organizations: insert as owner"
  on public.organizations for insert
  with check (owner_id = auth.uid());

-- Only admins can update their org.
create policy "organizations: update if admin"
  on public.organizations for update
  using (
    id = public.auth_user_org_id()
    and public.auth_user_role() = 'admin'
  );


-- ── 5. LEADS policies ────────────────────────────────────────

create policy "leads: read own org"
  on public.leads for select
  using (organization_id = public.auth_user_org_id());

create policy "leads: insert own org"
  on public.leads for insert
  with check (organization_id = public.auth_user_org_id());

create policy "leads: update own org"
  on public.leads for update
  using (organization_id = public.auth_user_org_id());

create policy "leads: delete if admin"
  on public.leads for delete
  using (
    organization_id = public.auth_user_org_id()
    and public.auth_user_role() = 'admin'
  );


-- ── 6. TICKETS policies ──────────────────────────────────────

create policy "tickets: read own org"
  on public.tickets for select
  using (organization_id = public.auth_user_org_id());

create policy "tickets: insert own org"
  on public.tickets for insert
  with check (organization_id = public.auth_user_org_id());

create policy "tickets: update own org"
  on public.tickets for update
  using (organization_id = public.auth_user_org_id());

create policy "tickets: delete if admin"
  on public.tickets for delete
  using (
    organization_id = public.auth_user_org_id()
    and public.auth_user_role() = 'admin'
  );
