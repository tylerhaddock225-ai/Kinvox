-- Kinvox — Social reply system: encrypted credentials + outbound pipeline.
--
-- Adds:
--   1. social_platform ENUM        — single source of truth for platform values.
--   2. organization_credentials    — one row per (org, platform). Token bytes
--                                    live in vault.secrets; this table only
--                                    stores secret_id + non-sensitive metadata.
--   3. outbound_messages           — append-mostly tracker of every reply we
--                                    attempt to relay. signal_id FKs
--                                    pending_signals; the row id doubles as
--                                    the credit_ledger reference_id so
--                                    deduct_credit() is idempotent per send.
--   4. set_organization_credential — SECURITY DEFINER, service_role-only.
--                                    Upserts the vault secret + metadata row.
--   5. get_decrypted_credential    — SECURITY DEFINER, service_role-only.
--                                    Returns the decrypted token for a writer.
--   6. record_outbound_send        — SECURITY DEFINER, service_role-only.
--                                    Atomic: flip status='sent', stamp
--                                    external_post_id, deduct 1 credit
--                                    against organization_id with the
--                                    outbound_messages.id as reference_id.


-- ─────────────────────────────────────────────────────────────
-- 1. social_platform enum
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'social_platform') then
    create type public.social_platform as enum ('reddit', 'x', 'facebook', 'threads');
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────
-- 2. organization_credentials
--
--    secret_id is intentionally NOT a hard FK — vault is in another schema
--    and Supabase doesn't permit cross-schema FKs to vault.secrets. We
--    enforce integrity via the SECURITY DEFINER write path.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.organization_credentials (
  id               uuid                   primary key default gen_random_uuid(),
  organization_id  uuid                   not null
                                          references public.organizations(id) on delete cascade,
  platform         public.social_platform not null,
  secret_id        uuid                   not null,
  account_handle   text,
  scopes           text[]                 not null default '{}',
  expires_at       timestamptz,
  status           text                   not null default 'active'
                                          check (status in ('active','revoked','expired')),
  created_by       uuid                   references public.profiles(id) on delete set null,
  created_at       timestamptz            not null default now(),
  updated_at       timestamptz            not null default now(),
  unique (organization_id, platform)
);

create trigger set_organization_credentials_updated_at
  before update on public.organization_credentials
  for each row execute function public.set_updated_at();

alter table public.organization_credentials enable row level security;

-- Tenants may SELECT non-secret metadata (handle, status, scopes,
-- expires_at) so the dashboard can show "Reddit: connected as u/x".
-- They never see secret_id (column-level grant below). HQ admins see all.
create policy "creds: select own org or hq"
  on public.organization_credentials for select
  to authenticated
  using (public.is_admin_hq() or organization_id = public.auth_user_org_id());

-- No INSERT/UPDATE/DELETE policies for tenants. All writes flow through
-- set_organization_credential() (SECURITY DEFINER, service_role).

grant select (id, organization_id, platform, account_handle, scopes,
              expires_at, status, created_by, created_at, updated_at)
  on public.organization_credentials to authenticated;
grant all on public.organization_credentials to service_role;


-- ─────────────────────────────────────────────────────────────
-- 3. outbound_messages
-- ─────────────────────────────────────────────────────────────

create table if not exists public.outbound_messages (
  id                uuid                   primary key default gen_random_uuid(),
  organization_id   uuid                   not null
                                           references public.organizations(id) on delete cascade,
  signal_id         uuid                   not null
                                           references public.pending_signals(id) on delete cascade,
  platform          public.social_platform not null,
  body              text                   not null,
  status            text                   not null default 'draft'
                                           check (status in ('draft','pending_approval','sent','failed')),
  external_post_id  text,
  error_message     text,
  approved_by       uuid                   references public.profiles(id) on delete set null,
  sent_at           timestamptz,
  created_at        timestamptz            not null default now(),
  updated_at        timestamptz            not null default now()
);

create index if not exists outbound_messages_org_status_created_idx
  on public.outbound_messages (organization_id, status, created_at desc);

-- Partial unique index: only one live (pending_approval) or sent row per
-- (signal, platform). A 'failed' send can be retried by inserting a new
-- row; a 'sent' one can never be sent again. 'draft' rows are unconstrained
-- so a tenant can edit/save multiple times before approving.
create unique index if not exists outbound_messages_signal_unique_per_platform
  on public.outbound_messages (signal_id, platform)
  where status in ('pending_approval','sent');

create trigger set_outbound_messages_updated_at
  before update on public.outbound_messages
  for each row execute function public.set_updated_at();

alter table public.outbound_messages enable row level security;

create policy "outbound: select own org or hq"
  on public.outbound_messages for select
  to authenticated
  using (public.is_admin_hq() or organization_id = public.auth_user_org_id());

-- Tenants may insert drafts and flip them to pending_approval for their own
-- org. The 'sent' / 'failed' transitions are reserved for the writer route
-- via record_outbound_send().
create policy "outbound: insert own org or hq"
  on public.outbound_messages for insert
  to authenticated
  with check (
    (public.is_admin_hq() or organization_id = public.auth_user_org_id())
    and status in ('draft','pending_approval')
  );

create policy "outbound: update own org or hq (pre-send only)"
  on public.outbound_messages for update
  to authenticated
  using (
    (public.is_admin_hq() or organization_id = public.auth_user_org_id())
    and status in ('draft','pending_approval')
  )
  with check (
    (public.is_admin_hq() or organization_id = public.auth_user_org_id())
    and status in ('draft','pending_approval')
  );

grant select, insert, update on public.outbound_messages to authenticated;
grant all                    on public.outbound_messages to service_role;


-- ─────────────────────────────────────────────────────────────
-- 4. set_organization_credential — vault upsert + metadata row
--
--    Naming convention: secrets are named org_cred_<org>_<platform> so a
--    re-connect for the same (org, platform) updates the existing secret
--    in place rather than orphaning the old one.
-- ─────────────────────────────────────────────────────────────

create or replace function public.set_organization_credential(
  p_org_id     uuid,
  p_platform   public.social_platform,
  p_token      text,
  p_handle     text,
  p_scopes     text[],
  p_expires_at timestamptz,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret_name text;
  v_secret_id   uuid;
  v_existing_id uuid;
begin
  if p_token is null or length(p_token) = 0 then
    raise exception 'token must not be empty' using errcode = '22023';
  end if;

  v_secret_name := format('org_cred_%s_%s', p_org_id, p_platform);

  select id into v_existing_id from vault.secrets where name = v_secret_name;

  if v_existing_id is null then
    v_secret_id := vault.create_secret(p_token, v_secret_name);
  else
    perform vault.update_secret(v_existing_id, p_token, v_secret_name);
    v_secret_id := v_existing_id;
  end if;

  insert into public.organization_credentials
    (organization_id, platform, secret_id, account_handle, scopes,
     expires_at, created_by, status)
  values
    (p_org_id, p_platform, v_secret_id, p_handle, coalesce(p_scopes, '{}'),
     p_expires_at, p_created_by, 'active')
  on conflict (organization_id, platform) do update
    set secret_id      = excluded.secret_id,
        account_handle = excluded.account_handle,
        scopes         = excluded.scopes,
        expires_at     = excluded.expires_at,
        status         = 'active',
        updated_at     = now();

  return v_secret_id;
end;
$$;

revoke all on function public.set_organization_credential(
  uuid, public.social_platform, text, text, text[], timestamptz, uuid
) from public;
grant execute on function public.set_organization_credential(
  uuid, public.social_platform, text, text, text[], timestamptz, uuid
) to service_role;


-- ─────────────────────────────────────────────────────────────
-- 5. get_decrypted_credential — server-side token resolution
--
--    Only the service_role may invoke this. Tenants never see plaintext
--    tokens — even an HQ admin gets the token through the writer route,
--    never directly.
-- ─────────────────────────────────────────────────────────────

create or replace function public.get_decrypted_credential(
  p_org_id   uuid,
  p_platform public.social_platform
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret_id uuid;
  v_token     text;
begin
  select secret_id into v_secret_id
    from public.organization_credentials
   where organization_id = p_org_id
     and platform        = p_platform
     and status          = 'active';

  if v_secret_id is null then
    raise exception 'credential_not_found' using errcode = 'P0001';
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where id = v_secret_id;

  if v_token is null then
    raise exception 'credential_decrypt_failed' using errcode = 'P0001';
  end if;

  return v_token;
end;
$$;

revoke all on function public.get_decrypted_credential(uuid, public.social_platform) from public;
grant execute on function public.get_decrypted_credential(uuid, public.social_platform) to service_role;


-- ─────────────────────────────────────────────────────────────
-- 6. record_outbound_send — atomic flip + ledger deduction
--
--    Called by the writer route AFTER a successful platform POST. Uses
--    outbound_messages.id as deduct_credit.reference_id so the ledger's
--    credit_ledger_reference_idx makes the charge idempotent on retry.
--    deduct_credit hard-codes type='signal_deduction'; the reference_id
--    is what distinguishes outbound sends from unlocks in audit queries.
-- ─────────────────────────────────────────────────────────────

create or replace function public.record_outbound_send(
  p_outbound_id      uuid,
  p_external_post_id text,
  p_charge           int default 1
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id  uuid;
  v_status  text;
  v_balance int;
begin
  select organization_id, status
    into v_org_id, v_status
    from public.outbound_messages
   where id = p_outbound_id
   for update;

  if v_org_id is null then
    raise exception 'outbound_not_found' using errcode = 'P0001';
  end if;

  if v_status = 'sent' then
    -- Idempotent: caller retried after a partial success. Don't double-charge.
    return null;
  end if;

  update public.outbound_messages
     set status            = 'sent',
         external_post_id  = p_external_post_id,
         sent_at           = now(),
         updated_at        = now()
   where id = p_outbound_id;

  v_balance := public.deduct_credit(v_org_id, p_charge, p_outbound_id);
  return v_balance;
end;
$$;

revoke all on function public.record_outbound_send(uuid, text, int) from public;
grant execute on function public.record_outbound_send(uuid, text, int) to service_role;
