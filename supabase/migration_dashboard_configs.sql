-- ============================================================
-- Migration: Dashboard Configs + Support Stats RPC
-- Run in Supabase → SQL Editor.
-- ============================================================


-- ── 1. user_dashboard_configs ────────────────────────────────────────────────
--    One row per user; hidden_widgets stores widget IDs the user has toggled off.

create table if not exists public.user_dashboard_configs (
  user_id         uuid        primary key references auth.users(id) on delete cascade,
  organization_id uuid        references public.organizations(id) on delete set null,
  hidden_widgets  text[]      not null default '{}',
  updated_at      timestamptz not null default now()
);

alter table public.user_dashboard_configs enable row level security;

create policy "Users manage own dashboard config"
  on public.user_dashboard_configs for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create trigger set_user_dashboard_configs_updated_at
  before update on public.user_dashboard_configs
  for each row execute function public.set_updated_at();


-- ── 2. get_support_stats RPC ─────────────────────────────────────────────────
--    Returns three support KPIs for an org in a single round-trip.
--    Called from the dashboard Server Component after verifying org membership.

create or replace function public.get_support_stats(p_org_id uuid)
returns table(
  open_count   bigint,
  closed_week  bigint,
  avg_hours    numeric
)
language sql security definer stable as $$
  select
    -- All non-closed, non-deleted tickets
    (
      select count(*)
      from   public.tickets
      where  organization_id = p_org_id
        and  status         != 'closed'
        and  deleted_at      is null
    ) as open_count,

    -- Tickets closed in the last 7 days
    (
      select count(*)
      from   public.tickets
      where  organization_id = p_org_id
        and  status          = 'closed'
        and  updated_at     >= now() - interval '7 days'
    ) as closed_week,

    -- Average resolution time (resolved_at - created_at) in hours, 1 decimal
    (
      select round(
        extract(epoch from avg(resolved_at - created_at)) / 3600.0,
        1
      )
      from   public.tickets
      where  organization_id = p_org_id
        and  resolved_at     is not null
        and  status          in ('resolved', 'closed')
    ) as avg_hours
$$;
