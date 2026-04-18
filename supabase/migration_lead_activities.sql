-- ============================================================
-- Migration: Lead activities (notes / timeline)
-- Run in Supabase → SQL Editor.
-- ============================================================


-- ── 1. Table ─────────────────────────────────────────────────────────────────

create table if not exists public.lead_activities (
  id         uuid        primary key default gen_random_uuid(),
  lead_id    uuid        not null
                         references public.leads(id) on delete cascade,
  user_id    uuid
                         references public.profiles(id) on delete set null,
  content    text        not null,
  created_at timestamptz not null default now()
);


-- ── 2. Indexes ───────────────────────────────────────────────────────────────

create index if not exists lead_activities_lead_created_idx
  on public.lead_activities(lead_id, created_at desc);


-- ── 3. RLS ───────────────────────────────────────────────────────────────────

alter table public.lead_activities enable row level security;

create policy "Org members can view lead activities"
  on public.lead_activities for select
  using (
    lead_id in (
      select l.id from public.leads l
      where l.organization_id in (
        select organization_id from public.profiles where id = auth.uid()
      )
    )
  );

create policy "Org members can insert lead activities"
  on public.lead_activities for insert
  with check (
    user_id = auth.uid()
    and lead_id in (
      select l.id from public.leads l
      where l.organization_id in (
        select organization_id from public.profiles where id = auth.uid()
      )
    )
  );

create policy "Authors can delete their own lead activities"
  on public.lead_activities for delete
  using (user_id = auth.uid());
