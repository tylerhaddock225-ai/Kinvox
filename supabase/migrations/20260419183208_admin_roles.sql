-- ============================================================
-- Migration: Internal admin roles (HQ-level permission scaffold).
-- Run in Supabase → SQL Editor or via `supabase db push`.
--
-- Scope
--   • Create the 'internal_role' enum ('platform_owner', 'platform_support').
--   • Add a nullable 'system_role' column to public.profiles.
--   • Create is_admin_hq() — a security helper returning TRUE when the
--     current auth.uid() has a non-null system_role.
--
-- Fully idempotent: enum creation is guarded by a DO block, the column
-- uses IF NOT EXISTS, and the function uses CREATE OR REPLACE.
-- ============================================================


-- ── 1. internal_role enum ───────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'internal_role'
  ) then
    create type public.internal_role as enum ('platform_owner', 'platform_support');
  end if;
end
$$;


-- ── 2. system_role column on profiles ───────────────────────────────────────

alter table public.profiles
  add column if not exists system_role public.internal_role default null;


-- ── 3. Security helper — is_admin_hq() ──────────────────────────────────────
--
-- Returns TRUE when the calling user has any non-null system_role in
-- public.profiles. Marked security definer + stable so it can be used
-- safely inside RLS policies without re-evaluating per row.

create or replace function public.is_admin_hq()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and system_role is not null
  )
$$;
