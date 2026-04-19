-- ============================================================
-- Migration: Custom Roles
-- Adds 'roles' table linked to organizations.
-- Adds 'role_id' FK to profiles.
-- Adds security-definer RPC for middleware permission check.
-- Run in Supabase → SQL Editor.
-- ============================================================


-- ── 1. roles table ──────────────────────────────────────────────────────────

create table if not exists public.roles (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null
                              references public.organizations(id) on delete cascade,
  name            text        not null,
  permissions     jsonb       not null default '{
    "view_leads":        true,
    "edit_leads":        true,
    "view_tickets":      true,
    "edit_tickets":      true,
    "view_appointments": true,
    "manage_team":       false
  }'::jsonb,
  is_system_role  boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);


-- ── 2. role_id column on profiles ───────────────────────────────────────────

alter table public.profiles
  add column if not exists role_id uuid
    references public.roles(id) on delete set null;


-- ── 3. updated_at trigger ───────────────────────────────────────────────────

create trigger set_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();


-- ── 4. Indexes ──────────────────────────────────────────────────────────────

create index if not exists roles_org_idx     on public.roles(organization_id);
create index if not exists profiles_role_idx on public.profiles(role_id);


-- ── 5. RLS ──────────────────────────────────────────────────────────────────

alter table public.roles enable row level security;

create policy "Org members can view roles"
  on public.roles for select
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
    )
  );

-- Single ALL policy for admins (insert / update / delete)
create policy "Admins can manage roles"
  on public.roles for all
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  )
  with check (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- ── 6. Security-definer RPC — used by middleware for /leads access check ────
--
-- Returns the value of permissions->>'view_leads' for the current user's
-- custom role.  Falls back to TRUE when no role_id is assigned so that
-- existing users without a custom role retain full access.

create or replace function public.auth_user_view_leads()
returns boolean language sql security definer stable as $$
  select coalesce(
    (
      select (r.permissions->>'view_leads')::boolean
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
    ),
    true
  )
$$;
