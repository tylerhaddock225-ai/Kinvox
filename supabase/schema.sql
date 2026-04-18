-- ============================================================
-- Kinvox — Walking Skeleton Schema v1.1
-- Based on: TechnicalArchitectureDocument_WalkingSkeleton_4
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Order: Tables → FKs → Triggers → Auth Trigger → Policies → Seed
-- ============================================================


-- ── Extensions ──────────────────────────────────────────────
create extension if not exists "pgcrypto";


-- ============================================================
-- SECTION 1 — CREATE ALL TABLES (no cross-table FKs yet)
-- ============================================================

create table if not exists public.organizations (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null,
  slug           text        not null unique,
  plan           text        not null default 'free'
                             check (plan in ('free', 'pro', 'enterprise')),
  owner_id       uuid        not null,          -- FK added in Section 2
  address_line1  text,
  address_line2  text,
  city           text,
  state          text,
  postal_code    text,
  country        text        not null default 'US',
  phone          text,
  website        text,
  logo_url       text,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.profiles (
  id              uuid        primary key references auth.users(id) on delete cascade,
  organization_id uuid,                         -- FK added in Section 2
  full_name       text,
  avatar_url      text,
  role            text        not null default 'agent'
                              check (role in ('admin', 'agent', 'viewer')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.leads (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,         -- FK added in Section 2
  assigned_to     uuid,                         -- FK added in Section 2
  first_name      text        not null,
  last_name       text,
  email           text,
  phone           text,
  company         text,
  status          text        not null default 'new'
                              check (status in ('new', 'contacted', 'qualified', 'lost', 'converted')),
  source          text        check (source in ('web', 'referral', 'import', 'manual', 'other')),
  notes           text,
  tags            text[],
  metadata        jsonb,
  converted_at    timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.tickets (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,         -- FK added in Section 2
  lead_id         uuid,                         -- FK added in Section 2
  assigned_to     uuid,                         -- FK added in Section 2
  created_by      uuid        not null,         -- FK added in Section 2
  subject         text        not null,
  description     text,
  status          text        not null default 'open'
                              check (status in ('open', 'pending', 'resolved', 'closed')),
  priority        text        not null default 'medium'
                              check (priority in ('low', 'medium', 'high', 'urgent')),
  channel         text        check (channel in ('email', 'chat', 'phone', 'portal', 'manual')),
  tags            text[],
  due_at          timestamptz,
  resolved_at     timestamptz,
  closed_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);


-- ============================================================
-- SECTION 2 — ADD FOREIGN KEYS (all tables exist now)
-- ============================================================

alter table public.organizations
  add constraint organizations_owner_id_fkey
  foreign key (owner_id) references public.profiles(id)
  deferrable initially deferred;

alter table public.profiles
  add constraint profiles_organization_id_fkey
  foreign key (organization_id) references public.organizations(id)
  on delete cascade;

alter table public.leads
  add constraint leads_organization_id_fkey
  foreign key (organization_id) references public.organizations(id)
  on delete cascade;

alter table public.leads
  add constraint leads_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id)
  on delete set null;

alter table public.tickets
  add constraint tickets_organization_id_fkey
  foreign key (organization_id) references public.organizations(id)
  on delete cascade;

alter table public.tickets
  add constraint tickets_lead_id_fkey
  foreign key (lead_id) references public.leads(id)
  on delete set null;

alter table public.tickets
  add constraint tickets_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id)
  on delete set null;

alter table public.tickets
  add constraint tickets_created_by_fkey
  foreign key (created_by) references public.profiles(id)
  on delete restrict;


-- ============================================================
-- SECTION 3 — INDEXES
-- ============================================================

create index if not exists profiles_org_idx
  on public.profiles(organization_id);

-- Optimises primary dashboard query (doc Section 2.3)
create index if not exists leads_org_status_idx
  on public.leads(organization_id, status);

-- Unique email per org, ignoring soft-deleted rows
create unique index if not exists leads_org_email_unique
  on public.leads(organization_id, email)
  where deleted_at is null and email is not null;

-- Supports the support queue view (doc Section 2.4)
create index if not exists tickets_org_status_priority_idx
  on public.tickets(organization_id, status, priority);


-- ============================================================
-- SECTION 4 — updated_at TRIGGER FUNCTION + TRIGGERS
-- ============================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

create trigger set_tickets_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();


-- ============================================================
-- SECTION 5 — AUTH TRIGGER (auto-create profile on signup)
-- ============================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- SECTION 6 — ENABLE RLS
-- ============================================================

alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.leads         enable row level security;
alter table public.tickets       enable row level security;


-- ============================================================
-- SECTION 7 — RLS POLICIES
-- ============================================================

-- organizations
create policy "Members can view own organization"
  on public.organizations for select
  using (
    id in (
      select organization_id from public.profiles
      where profiles.id = auth.uid()
    )
  );

create policy "Admins can update own organization"
  on public.organizations for update
  using (
    id in (
      select organization_id from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- profiles
create policy "Users can view own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "Admins can view org profiles"
  on public.profiles for select
  using (
    organization_id in (
      select organization_id from public.profiles p2
      where p2.id = auth.uid() and p2.role = 'admin'
    )
  );

create policy "Users can update own profile"
  on public.profiles for update
  using (id = auth.uid());

-- leads
create policy "Org members can view leads"
  on public.leads for select
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
    )
  );

create policy "Org members can insert leads"
  on public.leads for insert
  with check (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
    )
  );

create policy "Org members can update leads"
  on public.leads for update
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
    )
  );

create policy "Admins can delete leads"
  on public.leads for delete
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- tickets
create policy "Org members can view tickets"
  on public.tickets for select
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
    )
  );

create policy "Org members can insert tickets"
  on public.tickets for insert
  with check (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
    )
  );

create policy "Org members can update tickets"
  on public.tickets for update
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid()
    )
  );

create policy "Admins can delete tickets"
  on public.tickets for delete
  using (
    organization_id in (
      select organization_id from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- ============================================================
-- SECTION 8 — SEED DATA
--   1 org · 2 profiles · 5 leads · 3 tickets
--   Inserts into auth.users first — the handle_new_user trigger
--   then auto-creates the matching profile rows.
--   Fixed UUIDs make this idempotent (safe to re-run).
-- ============================================================

do $$
declare
  v_org_id uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_admin  uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  v_agent  uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_lead1  uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_lead2  uuid := 'cccccccc-0000-0000-0000-000000000002';
  v_lead3  uuid := 'cccccccc-0000-0000-0000-000000000003';
  v_lead4  uuid := 'cccccccc-0000-0000-0000-000000000004';
  v_lead5  uuid := 'cccccccc-0000-0000-0000-000000000005';
begin

  -- Step 1: seed auth.users so profiles FK is satisfied.
  -- handle_new_user trigger fires and creates profile rows automatically.
  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    aud, role, created_at, updated_at
  ) values
    (
      v_admin, 'admin@kinvox-demo.com',
      crypt('Demo1234!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Alex Admin"}',
      'authenticated', 'authenticated', now(), now()
    ),
    (
      v_agent, 'agent@kinvox-demo.com',
      crypt('Demo1234!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Sam Agent"}',
      'authenticated', 'authenticated', now(), now()
    )
  on conflict (id) do nothing;

  -- Step 2: create the organization (owner_id FK is deferred, resolves at commit)
  insert into public.organizations (id, name, slug, plan, owner_id, city, state, country)
  values (v_org_id, 'Kinvox Demo Org', 'kinvox-demo', 'pro', v_admin, 'Oklahoma City', 'OK', 'US')
  on conflict (id) do nothing;

  -- Step 3: assign both profiles to the org and set roles
  update public.profiles
  set organization_id = v_org_id, role = 'admin'
  where id = v_admin;

  update public.profiles
  set organization_id = v_org_id, role = 'agent'
  where id = v_agent;

  -- Step 4: leads
  insert into public.leads
    (id, organization_id, assigned_to, first_name, last_name, email, company, status, source)
  values
    (v_lead1, v_org_id, v_agent, 'Jordan', 'Rivers',  'jordan@example.com', 'Rivers LLC',     'new',       'web'),
    (v_lead2, v_org_id, v_agent, 'Casey',  'Monroe',  'casey@example.com',  'Monroe Group',   'contacted', 'referral'),
    (v_lead3, v_org_id, v_admin, 'Taylor', 'Brooks',  'taylor@example.com', 'Brooks & Co',    'qualified', 'import'),
    (v_lead4, v_org_id, null,    'Morgan', 'Kim',     'morgan@example.com', null,             'new',       'manual'),
    (v_lead5, v_org_id, v_agent, 'Drew',   'Vasquez', 'drew@example.com',   'Vasquez Dental', 'converted', 'web')
  on conflict (id) do nothing;

  -- Step 5: tickets
  insert into public.tickets
    (organization_id, lead_id, assigned_to, created_by, subject, status, priority, channel)
  values
    (v_org_id, v_lead1, v_agent, v_admin, 'Unable to access portal',   'open',    'high',   'email'),
    (v_org_id, v_lead2, v_agent, v_agent, 'Pricing question',           'pending', 'medium', 'chat'),
    (v_org_id, null,    v_admin, v_admin, 'Onboarding walkthrough req', 'open',    'urgent', 'phone');

end $$;
