-- Phase 6b — Lead Activity Surface.
--
-- 1. Adds public.leads.last_lead_activity_at — bumped only by lead-originated
--    events (form resubmission, inbound email reply from the lead). Distinct
--    from updated_at, which is bumped by every UPDATE via set_updated_at()
--    including org-side writes (status change, edit, archive).
--
-- 2. Creates public.lead_views — per-user "last viewed" timestamps. The badge
--    on the leads list shows "unread" when leads.last_lead_activity_at
--    > lead_views.last_viewed_at for the (lead_id, user_id) pair.
--
-- 3. Drops public.lead_activities — dead code per audit (0 rows, 0 readers,
--    one orphaned writer in addLeadNote which is also being removed). The
--    Phase 6a system messages used lead_messages, not lead_activities.

begin;

-- ── 1. leads.last_lead_activity_at ────────────────────────────────────
alter table public.leads
  add column if not exists last_lead_activity_at timestamptz;

-- Backfill from the most recent lead-originated lead_messages row per lead.
-- author_kind IN ('lead', 'system') matches the Phase 6a + Phase 4/5
-- convention for lead-originated events.
update public.leads l
   set last_lead_activity_at = sub.most_recent
  from (
    select lead_id, max(created_at) as most_recent
      from public.lead_messages
     where author_kind in ('lead', 'system')
     group by lead_id
  ) sub
 where sub.lead_id = l.id;

-- Index for sorting/filtering by activity timestamp on the leads list.
-- Partial index because most leads won't have activity yet at backfill time;
-- adding the partial filter keeps it small without losing query coverage
-- (queries that ORDER BY last_lead_activity_at typically want non-null rows
-- first, which the index handles).
create index if not exists leads_org_last_activity_idx
  on public.leads (organization_id, last_lead_activity_at desc nulls last)
  where archived_at is null;


-- ── 2. lead_views table ───────────────────────────────────────────────
create table if not exists public.lead_views (
  lead_id        uuid        not null references public.leads(id) on delete cascade,
  user_id        uuid        not null references auth.users(id)   on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (lead_id, user_id)
);

alter table public.lead_views enable row level security;

-- Org-member SELECT: can view your own lead_views rows for leads in your org.
-- The lead_id → leads.organization_id chain enforces org scope without a
-- separate organization_id column on lead_views.
drop policy if exists "lead_views: select own" on public.lead_views;
create policy "lead_views: select own"
  on public.lead_views
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.leads
       where leads.id = lead_views.lead_id
         and leads.organization_id = public.auth_user_org_id()
    )
  );

-- Org-member INSERT: can record your own views on leads in your org.
drop policy if exists "lead_views: insert own" on public.lead_views;
create policy "lead_views: insert own"
  on public.lead_views
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.leads
       where leads.id = lead_views.lead_id
         and leads.organization_id = public.auth_user_org_id()
    )
  );

-- Org-member UPDATE: can update your own view timestamp.
drop policy if exists "lead_views: update own" on public.lead_views;
create policy "lead_views: update own"
  on public.lead_views
  for update
  to authenticated
  using ( user_id = auth.uid() )
  with check ( user_id = auth.uid() );

-- HQ-admin parity for impersonation. Mirrors the lead_messages-style author
-- invariant from 20260501000000_hq_admin_rls_parity.sql — admins can only
-- mint/update views attributed to their own auth.uid(), not on behalf of
-- other users.
drop policy if exists "lead_views: select hq_admin" on public.lead_views;
create policy "lead_views: select hq_admin"
  on public.lead_views
  for select
  to authenticated
  using ( public.is_admin_hq() and user_id = auth.uid() );

drop policy if exists "lead_views: insert hq_admin" on public.lead_views;
create policy "lead_views: insert hq_admin"
  on public.lead_views
  for insert
  to authenticated
  with check ( public.is_admin_hq() and user_id = auth.uid() );

drop policy if exists "lead_views: update hq_admin" on public.lead_views;
create policy "lead_views: update hq_admin"
  on public.lead_views
  for update
  to authenticated
  using      ( public.is_admin_hq() and user_id = auth.uid() )
  with check ( public.is_admin_hq() and user_id = auth.uid() );


-- ── 3. drop dead lead_activities table ────────────────────────────────
drop table if exists public.lead_activities;

commit;
