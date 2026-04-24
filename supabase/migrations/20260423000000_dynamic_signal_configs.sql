-- Kinvox — Scalable geofence engine for the multi-vertical signal router.
--
-- Adds per-(organization, vertical) listener configs with a center point +
-- radius-miles scope, plus an attribution FK on pending_signals so every
-- captured signal can be traced back to the config that matched it.
--
-- Relationship to the existing signal stack:
--   - organizations.ai_listening_enabled stays the master kill switch.
--   - organizations.signal_engagement_mode stays the HITL mode selector.
--   - signal_configs becomes the routing table consulted by
--     /api/v1/signals/capture to decide whether a signal is in scope.
--   - pending_signals.signal_config_id is ON DELETE SET NULL so removing
--     a config never destroys historical review rows.


-- ─────────────────────────────────────────────────────────────
-- 1. signal_configs
-- ─────────────────────────────────────────────────────────────

create table if not exists public.signal_configs (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  vertical        text        not null,
  center_lat      float8,
  center_long     float8,
  radius_miles    int4        not null default 50,
  keywords        text[]      not null default '{}',
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now()
);

-- Natural lookup key for the capture route: "for org X, show me active
-- configs matching this vertical." Partial index keeps the hot path small.
create index if not exists signal_configs_org_vertical_active_idx
  on public.signal_configs(organization_id, vertical)
  where is_active;


-- ─────────────────────────────────────────────────────────────
-- 2. pending_signals.signal_config_id  (attribution FK)
-- ─────────────────────────────────────────────────────────────

alter table public.pending_signals
  add column if not exists signal_config_id uuid
  references public.signal_configs(id) on delete set null;

create index if not exists pending_signals_config_idx
  on public.pending_signals(signal_config_id)
  where signal_config_id is not null;


-- ─────────────────────────────────────────────────────────────
-- 3. RLS — tenant members manage their own configs, HQ sees all
-- ─────────────────────────────────────────────────────────────

alter table public.signal_configs enable row level security;

create policy "signal_configs: select own org or hq"
  on public.signal_configs for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

create policy "signal_configs: insert own org or hq"
  on public.signal_configs for insert
  to authenticated
  with check (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

create policy "signal_configs: update own org or hq"
  on public.signal_configs for update
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  )
  with check (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

create policy "signal_configs: delete own org or hq"
  on public.signal_configs for delete
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

grant select, insert, update, delete on public.signal_configs to authenticated;
grant all                            on public.signal_configs to service_role;
