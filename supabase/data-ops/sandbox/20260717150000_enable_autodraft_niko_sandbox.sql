-- WORKSTREAM AD Stage 2 — sandbox test enablement (data-op, SANDBOX ONLY).
--
-- Flip Niko's Storm Protection to ai_drafting_mode='auto_draft' so inbound
-- customer messages auto-generate drafts for live testing. This org id exists
-- only on sandbox (prod's org is Kinvox Demo, a different id), so this is a
-- no-op on prod — never run it there.
--
-- NOTE: applied via the Supabase Management API against the sandbox project ref
-- (ntwimeqxyyvjyrisqofl), NOT scripts/run-data-op.mjs — the Supabase CLI can't
-- run non-interactively in this environment (no DB password). Logged in _log.md
-- per convention.

update public.organizations
   set ai_drafting_mode = 'auto_draft'
 where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3';  -- Niko's Storm Protection
