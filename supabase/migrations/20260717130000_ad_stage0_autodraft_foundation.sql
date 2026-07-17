-- WORKSTREAM AD Stage 0 — Auto-Draft schema foundation.
--
-- Pure schema. NOTHING reads these objects yet — consumers arrive in AD-1..6
-- (spine, inbound enqueue, drainer, notification surface, mode UI, refill sweep).
-- No behavior change.
--
-- Decision locked: async drafting = ai_draft_jobs queue drained by a Vercel-Cron
-- endpoint (with after() layered later for the fast path); the same queue also
-- feeds the refill sweep. This migration lays only the storage.
--
-- A) ai_ticket_drafts  — one live stored draft per ticket (UNIQUE ticket_id).
-- B) ai_draft_jobs      — the draft queue (webhook enqueue + refill sweep feed it).
-- C) tickets.last_ticket_activity_at — mirror of leads.last_lead_activity_at
--    (precedent: 20260519163757_lead_activity_surface). No backfill.
-- D) ticket_views       — per-user read tracking, policies mirrored from lead_views.
-- E) organizations.ai_drafting_mode — org-side chooser (manual | auto_draft).
-- F) (skipped) the "unanswered"-sweep index (ticket_id, created_at) already exists
--    as ticket_messages_ticket_created_idx — a plain btree, usable in both scan
--    directions — so no new index is created here.
--
-- RLS posture (A, B): SELECT own-org-or-HQ; NO write policies → service-role
-- writes only (fail-closed), mirroring public.ai_usage_log.

begin;

-- ── A) ai_ticket_drafts ────────────────────────────────────────────────────
create table public.ai_ticket_drafts (
  id                uuid        primary key default gen_random_uuid(),
  ticket_id         uuid        not null unique
                                references public.tickets(id) on delete cascade,
  organization_id   uuid        not null
                                references public.organizations(id) on delete cascade,
  body              text        not null,
  -- The inbound customer message this draft answers — the staleness key. When a
  -- newer inbound arrives, the draft is regenerated (upsert on the UNIQUE ticket_id).
  source_message_id uuid        not null
                                references public.ticket_messages(id) on delete cascade,
  model             text        not null,
  -- NULL = system auto-draft; set to the acting profile for the on-demand path.
  created_by        uuid        references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index ai_ticket_drafts_org_created_idx
  on public.ai_ticket_drafts (organization_id, created_at desc);

create trigger set_ai_ticket_drafts_updated_at
  before update on public.ai_ticket_drafts
  for each row execute function public.set_updated_at();

alter table public.ai_ticket_drafts enable row level security;

-- SELECT for own-org members + HQ admins (impersonation-safe via is_admin_hq()).
-- No INSERT/UPDATE/DELETE policies: writes come only from the service-role admin
-- client (which bypasses RLS), so the table is fail-closed against tenant writes.
create policy "ai_ticket_drafts: read own org or hq"
  on public.ai_ticket_drafts
  for select
  to authenticated
  using (organization_id = auth_user_org_id() or is_admin_hq());


-- ── B) ai_draft_jobs ───────────────────────────────────────────────────────
create table public.ai_draft_jobs (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null
                                references public.organizations(id) on delete cascade,
  ticket_id         uuid        not null
                                references public.tickets(id) on delete cascade,
  -- Nullable: refill-sweep jobs resolve the latest inbound message at drain time;
  -- inbound_message jobs pin the exact message they were enqueued for.
  source_message_id uuid        references public.ticket_messages(id) on delete cascade,
  status            text        not null default 'pending'
                                check (status in ('pending','processing','done','failed','skipped')),
  reason            text        not null
                                check (reason in ('inbound_message','refill_sweep')),
  attempts          int         not null default 0,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One live job per ticket: at most one pending/processing row. Terminal rows
-- (done/failed/skipped) don't block a later re-enqueue.
create unique index ai_draft_jobs_live_ticket_idx
  on public.ai_draft_jobs (ticket_id)
  where status in ('pending', 'processing');

-- Drainer's oldest-first scan over the queue.
create index ai_draft_jobs_status_created_idx
  on public.ai_draft_jobs (status, created_at);

create trigger set_ai_draft_jobs_updated_at
  before update on public.ai_draft_jobs
  for each row execute function public.set_updated_at();

alter table public.ai_draft_jobs enable row level security;

-- SELECT own-org-or-HQ for debuggability; writes service-role only (no policies).
create policy "ai_draft_jobs: read own org or hq"
  on public.ai_draft_jobs
  for select
  to authenticated
  using (organization_id = auth_user_org_id() or is_admin_hq());


-- ── C) tickets.last_ticket_activity_at ─────────────────────────────────────
-- Bumped only by customer-originated events (arrives in AD-3). Distinct from
-- updated_at (bumped by every write). NULL = no unseen signal; no backfill.
alter table public.tickets
  add column last_ticket_activity_at timestamptz;

create index tickets_org_last_activity_idx
  on public.tickets (organization_id, last_ticket_activity_at desc nulls last);


-- ── D) ticket_views ────────────────────────────────────────────────────────
-- Per-user "last viewed" timestamps. The tickets-grid "unread" dot (AD-3) shows
-- when tickets.last_ticket_activity_at > ticket_views.last_viewed_at for the
-- (ticket_id, user_id) pair. Policies mirror lead_views (20260519163757).
create table public.ticket_views (
  ticket_id      uuid        not null references public.tickets(id)  on delete cascade,
  user_id        uuid        not null references public.profiles(id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);

alter table public.ticket_views enable row level security;

-- Org-member SELECT: your own view rows for tickets in your org. The
-- ticket_id → tickets.organization_id chain enforces org scope.
create policy "ticket_views: select own"
  on public.ticket_views
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.tickets
       where tickets.id = ticket_views.ticket_id
         and tickets.organization_id = public.auth_user_org_id()
    )
  );

-- Org-member INSERT: record your own views on tickets in your org.
create policy "ticket_views: insert own"
  on public.ticket_views
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.tickets
       where tickets.id = ticket_views.ticket_id
         and tickets.organization_id = public.auth_user_org_id()
    )
  );

-- Org-member UPDATE: bump your own view timestamp.
create policy "ticket_views: update own"
  on public.ticket_views
  for update
  to authenticated
  using ( user_id = auth.uid() )
  with check ( user_id = auth.uid() );

-- HQ-admin parity for impersonation — admins may only mint/update views
-- attributed to their own auth.uid(), never on behalf of another user.
create policy "ticket_views: select hq_admin"
  on public.ticket_views
  for select
  to authenticated
  using ( public.is_admin_hq() and user_id = auth.uid() );

create policy "ticket_views: insert hq_admin"
  on public.ticket_views
  for insert
  to authenticated
  with check ( public.is_admin_hq() and user_id = auth.uid() );

create policy "ticket_views: update hq_admin"
  on public.ticket_views
  for update
  to authenticated
  using      ( public.is_admin_hq() and user_id = auth.uid() )
  with check ( public.is_admin_hq() and user_id = auth.uid() );


-- ── E) organizations.ai_drafting_mode ──────────────────────────────────────
-- Org-side chooser. Master gate stays HQ's feature_flags.ai_support_enabled;
-- this mode is irrelevant when the master is off (enforced by consumers).
alter table public.organizations
  add column ai_drafting_mode text not null default 'manual'
    check (ai_drafting_mode in ('manual', 'auto_draft'));


-- ── F) sweep "unanswered" index — SKIPPED ──────────────────────────────────
-- ticket_messages_ticket_created_idx on (ticket_id, created_at) already exists
-- and serves the latest-inbound-per-ticket scan; no new index needed.

commit;
