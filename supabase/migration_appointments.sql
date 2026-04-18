-- ============================================================
-- Migration: Appointments table
-- Run in Supabase → SQL Editor.
-- ============================================================


-- ── 1. Table ─────────────────────────────────────────────────────────────────

create table if not exists public.appointments (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null
                              references public.organizations(id) on delete cascade,
  lead_id         uuid
                              references public.leads(id) on delete set null,
  assigned_to     uuid
                              references public.profiles(id) on delete set null,
  created_by      uuid        not null
                              references public.profiles(id) on delete restrict,
  title           text        not null,
  description     text,
  start_at        timestamptz not null,
  end_at          timestamptz,
  status          text        not null default 'scheduled'
                              check (status in ('scheduled', 'completed', 'cancelled')),
  location        text,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);


-- ── 2. Indexes ───────────────────────────────────────────────────────────────

create index if not exists appointments_org_start_idx
  on public.appointments(organization_id, start_at);


-- ── 3. updated_at trigger ────────────────────────────────────────────────────

create trigger set_appointments_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();


-- ── 4. RLS ───────────────────────────────────────────────────────────────────

alter table public.appointments enable row level security;

create policy "Org members can view appointments"
  on public.appointments for select
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Org members can insert appointments"
  on public.appointments for insert
  with check (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Org members can update appointments"
  on public.appointments for update
  using (
    organization_id in (
      select organization_id from public.profiles where id = auth.uid()
    )
  );

create policy "Admins can delete appointments"
  on public.appointments for delete
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );
