-- SMS Stage 2a — consent foundation for the SMS rail.
--
-- Pure additive schema. NOTHING sends SMS in this stage — this migration only
-- builds the opt-in layer that later stages (2b delivery/dual-send/inbound) will
-- gate on. Per-person consent is recorded with a timestamp (TCPA / A2P posture);
-- until opt-in, a person is email-only.
--
-- Both customer-facing rails (customers + leads) get the same three columns:
--   * sms_opt_in       — the gate. false until the person consents. NOT NULL
--     DEFAULT false so every existing row is correct with no backfill.
--   * sms_opted_in_at  — when consent was recorded (public opt-in page confirm,
--     or an org user flipping the manual "gave consent by phone" toggle). NULL
--     until opt-in.
--   * sms_opt_in_token — a single-purpose random token minted when a confirmation
--     email carrying the opt-in link is sent, and CONSUMED (nulled) the moment
--     the person confirms. Partial-unique (WHERE NOT NULL) so a live token
--     resolves to exactly one row. Deliberately NO expiry column: these tokens
--     are single-purpose and low-risk (they grant only "opt this row into SMS",
--     which the row's own owner already implicitly consents to by receiving the
--     mail), and they're nulled on use — an expiry window would add state without
--     materially reducing surface. Re-minting overwrites the prior token.
--
-- Divergence note: password-reset / claim / invite tokens store sha256(token) via
-- src/lib/auth/tokens.ts. This token is stored RAW by design (Tyler-approved) —
-- it is single-purpose, admin-client-only readable (no RLS SELECT path exposes
-- it), and consumed on first use, so the hashed-at-rest posture buys little here.
--
-- RLS: unchanged. New columns inherit each table's existing policies. The public
-- opt-in flow reads/writes exclusively through the service-role admin client in
-- server code (no anon/authenticated client ever touches sms_opt_in_token).

begin;

-- ── 1) customers — consent gate + timestamp + single-purpose token ──────────
alter table public.customers
  add column sms_opt_in boolean not null default false,
  add column sms_opted_in_at timestamptz,
  add column sms_opt_in_token text;

create unique index customers_sms_opt_in_token_unique
  on public.customers (sms_opt_in_token)
  where sms_opt_in_token is not null;

-- ── 2) leads — same three columns ───────────────────────────────────────────
alter table public.leads
  add column sms_opt_in boolean not null default false,
  add column sms_opted_in_at timestamptz,
  add column sms_opt_in_token text;

create unique index leads_sms_opt_in_token_unique
  on public.leads (sms_opt_in_token)
  where sms_opt_in_token is not null;

commit;

-- Verify (run separately / via API):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name in ('customers','leads')
--      and column_name in ('sms_opt_in','sms_opted_in_at','sms_opt_in_token')
--    order by table_name, column_name;
--   select indexname from pg_indexes
--    where schemaname='public'
--      and indexname in ('customers_sms_opt_in_token_unique','leads_sms_opt_in_token_unique');
