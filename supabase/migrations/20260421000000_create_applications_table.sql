-- Inbound applications from the public marketing site /apply form.
-- Writes happen exclusively through the server action using the
-- service role key; RLS is enabled with no policies so neither anon
-- nor authenticated roles can read or write directly.

create table if not exists public.applications (
  id              uuid primary key default gen_random_uuid(),
  business_name   text not null,
  email           text not null,
  website         text not null,
  source_ip       inet,
  status          text not null default 'new' check (status in ('new', 'contacted', 'approved', 'rejected')),
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid references auth.users(id)
);

create index if not exists applications_created_at_desc
  on public.applications (created_at desc);

create index if not exists applications_status_created_at
  on public.applications (status, created_at desc);

alter table public.applications enable row level security;

-- No policies: the service role key bypasses RLS, and no one else
-- should touch this table. HQ review UI (when added) will go through
-- a SECURITY DEFINER function.

comment on table public.applications is
  'Inbound leads from the public marketing /apply form. Service role writes only.';
