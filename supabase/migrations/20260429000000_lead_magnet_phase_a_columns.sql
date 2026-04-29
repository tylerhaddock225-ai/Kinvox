-- Kinvox — Lead Magnet Phase A: per-org capability flags, embed allowlist,
-- theming hooks, and subscription kill switch.
--
-- All adds are idempotent (`add column if not exists`) so re-running the
-- migration is safe. The CHECK constraint on subscription_status is added
-- inside a DO block so re-runs don't error on duplicate constraint names.
--
-- Application-layer wiring (helpers, route changes, UI) is intentionally
-- NOT part of this migration. Subsequent prompts will read these columns
-- from `isLeadCaptureLive(org)` and the `/q/[slug]` embed route.

-- ─────────────────────────────────────────────────────────────
-- 1. feature_flags — canonical per-org capability switch
-- ─────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists feature_flags jsonb not null default jsonb_build_object(
    'lead_magnet_enabled',       false,
    'embed_enabled',             false,
    'ai_support_enabled',        false,
    'review_monitoring_enabled', false,
    'crm_enabled',               false
  );

comment on column public.organizations.feature_flags is
  'Canonical per-org capability switch. Sprint 3 introduces five gates: '
  'lead_magnet_enabled, embed_enabled, ai_support_enabled, '
  'review_monitoring_enabled, crm_enabled. lead_magnet_enabled is one of '
  'the gates (alongside lead_magnet_settings.enabled and subscription_status) '
  'used by isLeadCaptureLive(org) to decide whether the public landing page renders.';

-- Backfill existing rows: merge the seeded default object on top of whatever
-- is currently stored. Right after `add column ... default ...` every row
-- already has the full object, but doing this explicitly keeps the migration
-- idempotent (re-running picks up any keys added later) and makes the
-- intended shape obvious.
update public.organizations
   set feature_flags = jsonb_build_object(
         'lead_magnet_enabled',       false,
         'embed_enabled',             false,
         'ai_support_enabled',        false,
         'review_monitoring_enabled', false,
         'crm_enabled',               false
       ) || coalesce(feature_flags, '{}'::jsonb);


-- ─────────────────────────────────────────────────────────────
-- 2. allowed_embed_domains — iframe frame-ancestors allowlist
-- ─────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists allowed_embed_domains text[] not null default '{}'::text[];

comment on column public.organizations.allowed_embed_domains is
  'Domains permitted to embed the org''s /q/[slug] page in an iframe. '
  'Consumed downstream to set Content-Security-Policy: frame-ancestors. '
  'Empty array means no third-party hosts may embed.';


-- ─────────────────────────────────────────────────────────────
-- 3-5. Theming columns (nullable, no defaults)
-- ─────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists primary_color   text;

comment on column public.organizations.primary_color is
  'Hex color string (e.g. #dc2626) used as the primary brand color on the '
  'lead-magnet page. Format validated at the application layer, not in the DB.';

alter table public.organizations
  add column if not exists secondary_color text;

comment on column public.organizations.secondary_color is
  'Hex color string used as the secondary brand color on the lead-magnet page. '
  'Format validated at the application layer, not in the DB.';

alter table public.organizations
  add column if not exists hero_image_url  text;

comment on column public.organizations.hero_image_url is
  'URL to the per-org hero image rendered on the lead-magnet page.';


-- ─────────────────────────────────────────────────────────────
-- 6. subscription_status — billing-state kill switch
-- ─────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists subscription_status text not null default 'active';

-- Idempotent CHECK: drop-if-exists then add, wrapped so DDL stays safe to
-- re-run. The constraint name is canonical so future migrations can find it.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname = 'organizations_subscription_status_check'
       and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      drop constraint organizations_subscription_status_check;
  end if;

  alter table public.organizations
    add constraint organizations_subscription_status_check
    check (subscription_status in ('active', 'past_due', 'cancelled'));
end$$;

comment on column public.organizations.subscription_status is
  'Subscription state machine: active | past_due | cancelled. Currently '
  'flipped manually in HQ. A future sprint will wire this to Stripe '
  'customer.subscription.* and invoice.payment_failed webhooks. The lead '
  'magnet page MUST only render when subscription_status = ''active''.';


-- ─────────────────────────────────────────────────────────────
-- EF5 pilot backfill — Niko's Storm Protection
--
-- Gated behind an existence check so this migration is safe in environments
-- where the pilot org id doesn't exist (e.g. Production).
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1
      from public.organizations
     where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3'
  ) then
    update public.organizations
       set feature_flags = feature_flags
                         || jsonb_build_object('lead_magnet_enabled', true),
           allowed_embed_domains = array[
             'ef5tornadoshelters.com',
             'www.ef5tornadoshelters.com'
           ]
     where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3';
  end if;
end$$;
