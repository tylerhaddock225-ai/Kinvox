-- Kinvox — Organization-level toggle for the AI Social Listening Agent.
--
-- When FALSE, the /api/v1/signals/capture endpoint short-circuits with
-- 403 before touching organization_credits. Default is TRUE so the feature
-- is on for every existing tenant (PPS billing remains the only gate).

alter table public.organizations
  add column if not exists ai_listening_enabled boolean not null default true;

-- Partial index supporting the route-handler fetch: lookups only care
-- about the flag itself, and the column is so hot that a plain btree on
-- id already suffices — so no extra index is needed here.
