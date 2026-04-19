-- ============================================================
-- Kinvox — Fix: organizations INSERT + SELECT policies
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================
-- Problem 1: INSERT policy may be missing or not evaluating correctly.
-- Problem 2: INSERT...SELECT chain fails because auth_user_org_id()
--            returns NULL before the profile is linked to the org.
--            Adding an owner-based SELECT policy fixes this.
-- ============================================================

-- Drop and recreate INSERT policy cleanly
drop policy if exists "organizations: insert as owner" on public.organizations;

create policy "organizations: insert as owner"
  on public.organizations for insert
  with check (owner_id = auth.uid());

-- Add SELECT policy based on owner_id so the INSERT...SELECT
-- chain works during onboarding (before profile is linked).
drop policy if exists "organizations: read if owner" on public.organizations;

create policy "organizations: read if owner"
  on public.organizations for select
  using (owner_id = auth.uid());
