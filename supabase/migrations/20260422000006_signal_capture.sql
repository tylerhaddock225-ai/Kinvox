-- Kinvox — Signal Capture API prerequisites (Sandbox ntwimeqxyyvjyrisqofl)
--
-- Enables POST /api/v1/signals/capture by provisioning:
--   1. A 'social_listening' value on the leads.source CHECK constraint,
--      matching the new PPS channel the AI agents push into.
--   2. An organization_api_keys table. Only sha256 hashes are stored;
--      the raw key is returned once at creation and never re-surfaced.
--   3. The `leads` table on the supabase_realtime publication so the
--      tenant's dashboard "pops" on every INSERT (idempotent).


-- ─────────────────────────────────────────────────────────────
-- 1. leads.source ← add 'social_listening'
-- ─────────────────────────────────────────────────────────────

alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads
  add constraint leads_source_check
  check (source = any (array[
    'web',
    'referral',
    'import',
    'manual',
    'other',
    'social_listening'
  ]::text[]));


-- ─────────────────────────────────────────────────────────────
-- 2. organization_api_keys
--
--    HQ provisions keys on behalf of orgs. The raw string only ever
--    exists in the caller's config (Make.com / n8n / etc.); we store
--    sha256(raw) and compare hashes at request time.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.organization_api_keys (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  key_hash        text        not null unique,
  label           text,
  created_by      uuid        references public.profiles(id) on delete set null,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists organization_api_keys_org_idx
  on public.organization_api_keys(organization_id);

-- Partial index supporting the route-handler lookup (hash match, not revoked).
create index if not exists organization_api_keys_active_idx
  on public.organization_api_keys(key_hash)
  where revoked_at is null;

alter table public.organization_api_keys enable row level security;

-- HQ-only. Tenants never read or write here — the raw key is handed over
-- out of band at creation time, then lives only in the caller's config.
create policy "api_keys: hq only"
  on public.organization_api_keys
  to authenticated
  using (public.is_admin_hq())
  with check (public.is_admin_hq());

grant select, insert, update on public.organization_api_keys to authenticated;
grant all                    on public.organization_api_keys to service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. Realtime — make sure leads broadcasts on supabase_realtime
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname    = 'supabase_realtime'
          and schemaname = 'public'
          and tablename  = 'leads'
     )
  then
    execute 'alter publication supabase_realtime add table public.leads';
  end if;
end $$;
