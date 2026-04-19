-- ============================================================
-- Migration: Custom password-reset tokens.
-- Run in Supabase → SQL Editor.
--
-- Tokens are stored as a SHA-256 hash so a stolen DB row cannot be used
-- to mint a reset link. The plaintext only ever lives in the email we
-- send to the user.
-- ============================================================

create table if not exists public.password_reset_tokens (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  token_hash  text        not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create unique index if not exists password_reset_tokens_hash_idx
  on public.password_reset_tokens(token_hash);

create index if not exists password_reset_tokens_user_idx
  on public.password_reset_tokens(user_id, expires_at desc);

-- All access goes through the service-role admin client; no end-user policies.
alter table public.password_reset_tokens enable row level security;
