-- Kinvox — Human-in-the-loop review queue for social signals.
--
-- Purpose:
--   When an organization sets signal_engagement_mode='ai_draft', the AI
--   captures a signal + proposed reply and parks it in pending_signals
--   instead of creating a lead immediately. A team member approves or
--   dismisses from their dashboard; approval promotes the row to a
--   lead (or relays the reply via external_post_id). 'manual' mode
--   keeps today's behavior — signals flow straight into leads.
--
-- Shape additions vs. the original audit sketch:
--   - RLS + tenant/HQ policies (mirrors leads/tickets conventions).
--   - CHECK constraint on status so junk values can't land.
--   - CHECK constraint on signal_engagement_mode (two known values).
--   - organization_id: NOT NULL + ON DELETE CASCADE so we don't orphan
--     pending reviews when an org is hard-deleted.
--   - Supporting index on (organization_id, status, created_at desc) —
--     the queue view's natural sort.


-- ─────────────────────────────────────────────────────────────
-- 1. organizations.signal_engagement_mode
-- ─────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists signal_engagement_mode text not null default 'ai_draft';

alter table public.organizations
  drop constraint if exists organizations_signal_engagement_mode_check;

alter table public.organizations
  add constraint organizations_signal_engagement_mode_check
  check (signal_engagement_mode in ('ai_draft', 'manual'));


-- ─────────────────────────────────────────────────────────────
-- 2. pending_signals
-- ─────────────────────────────────────────────────────────────

create table if not exists public.pending_signals (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null
                                references public.organizations(id) on delete cascade,
  raw_text          text,
  ai_draft_reply    text,
  intent_score      int         check (intent_score is null or intent_score in (1, 3, 6)),
  platform          text,
  status            text        not null default 'pending'
                                check (status in ('pending', 'approved', 'dismissed')),
  external_post_id  text,
  created_at        timestamptz not null default now()
);

create index if not exists pending_signals_org_status_created_idx
  on public.pending_signals(organization_id, status, created_at desc);


-- ─────────────────────────────────────────────────────────────
-- 3. RLS — tenant members read/act on their own queue, HQ sees all
-- ─────────────────────────────────────────────────────────────

alter table public.pending_signals enable row level security;

create policy "pending_signals: select own org or hq"
  on public.pending_signals for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

-- Tenants approve/dismiss from their dashboard. Inserts flow through
-- the service-role AI worker (RLS is bypassed), so no authenticated
-- INSERT policy is needed — leave that door closed.
create policy "pending_signals: update own org or hq"
  on public.pending_signals for update
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  )
  with check (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

grant select, update on public.pending_signals to authenticated;
grant all            on public.pending_signals to service_role;
