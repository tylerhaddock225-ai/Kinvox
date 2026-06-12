-- Workstream J (Stage 1a) — member_invitations table.
--
-- Backs the org-side "invite a teammate" flow. An org admin mints a
-- single-use, hashed token (sha256, raw token travels only in the outbound
-- email link) with a 7-day TTL; the J1b redeem flow looks the row up by
-- token_hash, provisions/attaches the profile, and stamps accepted_at /
-- accepted_by. We store the sha256 hash only, never the raw token, so a DB
-- leak alone can't be replayed — same discipline as password_reset_tokens
-- and organization_claims.
--
-- RLS parity mirrors the roles table: tenant admins manage their own org's
-- invitations (auth_user_org_id() + auth_user_role() = 'admin'); HQ admins
-- get full parity for impersonation. The redeem path runs through the admin
-- (service-role) client, so no anon/public policy is needed here.

begin;

create table public.member_invitations (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations(id) on delete cascade,
  email           text        not null,   -- caller normalizes to lowercase before insert
  full_name       text,
  role_id         uuid        references public.roles(id) on delete set null,
  token_hash      text        not null,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid        references auth.users(id) on delete set null,
  invited_by      uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- J1b redeem looks rows up by token_hash.
create index member_invitations_token_hash_idx
  on public.member_invitations (token_hash);

-- One active (un-accepted) invite per org + email. Case-insensitive via
-- lower(email) so "Foo@bar" and "foo@bar" can't both sit pending. Accepted
-- rows are excluded so a re-invite after acceptance is allowed.
create unique index member_invitations_org_email_active_unique
  on public.member_invitations (organization_id, lower(email))
  where accepted_at is null;

-- Keep updated_at honest, matching the roles table convention.
create trigger set_member_invitations_updated_at
  before update on public.member_invitations
  for each row execute function public.set_updated_at();

alter table public.member_invitations enable row level security;

-- ── Tenant admin policies ────────────────────────────────────────────────
drop policy if exists "member_invitations: select org admin" on public.member_invitations;
create policy "member_invitations: select org admin"
  on public.member_invitations for select
  using (
    public.auth_user_org_id() = organization_id
    and public.auth_user_role() = 'admin'
  );

drop policy if exists "member_invitations: insert org admin" on public.member_invitations;
create policy "member_invitations: insert org admin"
  on public.member_invitations for insert
  with check (
    public.auth_user_org_id() = organization_id
    and public.auth_user_role() = 'admin'
  );

drop policy if exists "member_invitations: update org admin" on public.member_invitations;
create policy "member_invitations: update org admin"
  on public.member_invitations for update
  using (
    public.auth_user_org_id() = organization_id
    and public.auth_user_role() = 'admin'
  )
  with check (
    public.auth_user_org_id() = organization_id
    and public.auth_user_role() = 'admin'
  );

drop policy if exists "member_invitations: delete org admin" on public.member_invitations;
create policy "member_invitations: delete org admin"
  on public.member_invitations for delete
  using (
    public.auth_user_org_id() = organization_id
    and public.auth_user_role() = 'admin'
  );

-- ── HQ admin parity ──────────────────────────────────────────────────────
drop policy if exists "member_invitations: select hq admin" on public.member_invitations;
create policy "member_invitations: select hq admin"
  on public.member_invitations for select
  using (public.is_admin_hq());

drop policy if exists "member_invitations: insert hq admin" on public.member_invitations;
create policy "member_invitations: insert hq admin"
  on public.member_invitations for insert
  with check (public.is_admin_hq());

drop policy if exists "member_invitations: update hq admin" on public.member_invitations;
create policy "member_invitations: update hq admin"
  on public.member_invitations for update
  using (public.is_admin_hq())
  with check (public.is_admin_hq());

drop policy if exists "member_invitations: delete hq admin" on public.member_invitations;
create policy "member_invitations: delete hq admin"
  on public.member_invitations for delete
  using (public.is_admin_hq());

commit;
