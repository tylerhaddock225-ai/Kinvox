-- WORKSTREAM S — drop all remaining signals DB objects (incl. outbound_messages).
--
-- outbound_messages is evidence-proven DEAD signals infra (NOT the preserve-list email/ticketing
-- rail): NOT NULL FK signal_id -> pending_signals, platform = social_platform enum, 0 rows, zero
-- live readers. The real email/ticket rail persists to ticket_messages / lead_messages and sends
-- via the pure-Postmark sendOrgTransactionalEmail — it never touches outbound_messages.
--
-- Stage 1 already removed ALL app + server code + the dead libs. Audit + this-turn re-confirm
-- (sandbox ntwimeqxyyvjyrisqofl) prove: zero live readers for every object below, and the ONLY
-- inbound FKs to any dropped table come from OTHER dropped tables
-- (outbound_messages -> pending_signals -> signal_configs) — no live/preserved table references
-- anything dropped here, so child-first ordering needs no CASCADE.
--
-- PRESERVED (deliberately NOT touched):
--   * social_platform enum  — still used by organization_credentials.platform and the vault RPCs
--                             get_decrypted_credential / set_organization_credential.
--   * organizations.signal_radius — repurposed as the live lead-magnet geofence radius.
--   * verticals, organization_credentials, credit_ledger / add_credits / deduct_credit.
--
-- NOT included here (separate go/no-go pending): organization_api_keys — signals-origin
--   (signal_capture migration) but generically named, 0 rows, independent (no FK entanglement);
--   left out so this turn drops only the explicitly-authorized signals set.
--
-- Order: RPC -> tables (FK-child first) -> shared-table columns. No enum dropped. No CASCADE.

begin;

-- 1) Signals RPC (SECURITY DEFINER, service_role-only, zero callers; reads/writes outbound_messages).
drop function if exists public.record_outbound_send(uuid, text, integer);

-- 2) Signals tables, FK-child-first. Each table's RLS policies, indexes, triggers, and (for
--    pending_signals) its supabase_realtime publication membership drop automatically with it.
drop table if exists public.outbound_messages;   -- references pending_signals
drop table if exists public.pending_signals;      -- references signal_configs
drop table if exists public.signal_configs;

-- 3) Signal columns on the shared organizations table (dead; zero live readers).
--    Drop the CHECK explicitly first (it would otherwise cascade with the column).
alter table public.organizations
  drop constraint if exists organizations_signal_engagement_mode_check;
alter table public.organizations
  drop column if exists signal_engagement_mode;
alter table public.organizations
  drop column if exists ai_listening_enabled;
-- organizations.signal_radius is deliberately KEPT (live lead-magnet geofence radius).

-- 4) Signal enums: NONE dropped. social_platform is the only signals-themed enum but remains in
--    use by preserved organization_credentials.platform and the credential vault RPCs.

commit;
