-- Workstream J revised (Stage 1) — hq_invitations table.
--
-- The HQ-side "invite an HQ user" flow — the platform-staff parallel of
-- member_invitations. Structurally mirrors member_invitations EXCEPT it carries
-- NO organization_id: an HQ user has system_role SET and organization_id NULL
-- (the profiles_no_dual_positive invariant). The absence of an org column IS the
-- structural enforcement here, so no no-dual-positive-style CHECK is needed.
--
-- An HQ admin mints a single-use, sha256-hashed token (the raw token travels
-- only in the outbound email link) with a TTL; the Stage 2 redeem flow looks the
-- row up by token_hash, provisions the HQ profile (system_role + org NULL + HQ
-- role_id), and stamps accepted_at / accepted_by. We store only the hash, never
-- the raw token — same discipline as member_invitations / password_reset_tokens.
--
-- RLS: HQ authority only. Matches the member_invitations HQ-admin parity policies
-- and the roles "HQ staff manage HQ roles" policy — both key on is_admin_hq().
-- App-layer hqGate('manage_users') enforces the finer permission-bag grant; RLS
-- uses the broad HQ-authority gate, consistent with the established pattern. The
-- redeem path runs through the admin (service-role) client, so no anon/tenant
-- policy is needed.
--
-- Note: accepted_by / invited_by reference public.profiles(id) (HQ users always
-- have a profile), a deliberate divergence from member_invitations which targets
-- auth.users(id).

begin;

create table public.hq_invitations (
  id           uuid                 primary key default gen_random_uuid(),
  email        text                 not null,   -- caller normalizes to lowercase before insert
  full_name    text,
  system_role  public.internal_role not null,   -- the HQ role being granted (enum)
  role_id      uuid                 references public.roles(id)    on delete set null,  -- HQ permission-bag role
  token_hash   text                 not null,
  expires_at   timestamptz          not null,
  accepted_at  timestamptz,
  accepted_by  uuid                 references public.profiles(id) on delete set null,
  invited_by   uuid                 references public.profiles(id) on delete set null,
  created_at   timestamptz          not null default now(),
  updated_at   timestamptz          not null default now()
);

-- Stage 2 redeem looks rows up by token_hash; unique so a single token maps to
-- exactly one invitation (and a hash can never collide across rows).
create unique index hq_invitations_token_hash_unique
  on public.hq_invitations (token_hash);

-- Email lookup for the pending-invite list / dedup pre-flight.
create index hq_invitations_email_idx
  on public.hq_invitations (email);

-- Keep updated_at honest, matching the member_invitations / roles convention.
create trigger set_hq_invitations_updated_at
  before update on public.hq_invitations
  for each row execute function public.set_updated_at();

alter table public.hq_invitations enable row level security;

-- ── HQ admin policies (HQ authority only — no org scoping) ────────────────
drop policy if exists "hq_invitations: select hq admin" on public.hq_invitations;
create policy "hq_invitations: select hq admin"
  on public.hq_invitations for select
  using (public.is_admin_hq());

drop policy if exists "hq_invitations: insert hq admin" on public.hq_invitations;
create policy "hq_invitations: insert hq admin"
  on public.hq_invitations for insert
  with check (public.is_admin_hq());

drop policy if exists "hq_invitations: update hq admin" on public.hq_invitations;
create policy "hq_invitations: update hq admin"
  on public.hq_invitations for update
  using (public.is_admin_hq())
  with check (public.is_admin_hq());

drop policy if exists "hq_invitations: delete hq admin" on public.hq_invitations;
create policy "hq_invitations: delete hq admin"
  on public.hq_invitations for delete
  using (public.is_admin_hq());

commit;
