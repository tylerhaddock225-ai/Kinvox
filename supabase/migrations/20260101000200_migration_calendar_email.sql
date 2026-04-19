-- ============================================================
-- Migration: Per-profile calendar email override.
-- Run in Supabase → SQL Editor.
--
-- Outbound appointment invites (ICS attachments) are sent to this address
-- when set; otherwise the action falls back to the user's auth email.
-- Useful when an agent's login email differs from the calendar they
-- actually live in (Google Workspace alias, shared mailbox, etc.).
-- ============================================================

alter table public.profiles
  add column if not exists calendar_email text;
