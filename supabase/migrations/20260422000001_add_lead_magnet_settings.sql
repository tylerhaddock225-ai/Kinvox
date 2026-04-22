-- Public lead-magnet landing pages. One slug per org; null slug means
-- the landing page is disabled entirely. Settings carry the headline
-- and a feature list the landing page can render without schema churn.

alter table public.organizations
  add column if not exists lead_magnet_slug     text,
  add column if not exists lead_magnet_settings jsonb not null default
    '{"enabled": false, "headline": "Check your eligibility", "features": []}'::jsonb,
  add column if not exists website_url          text;

-- Case-insensitive uniqueness on slug, but only when set. Partial index
-- lets many rows keep null without collision and lets lookups hit the
-- same comparator the URL resolver will use (lower(slug)).
create unique index if not exists organizations_lead_magnet_slug_unique
  on public.organizations (lower(lead_magnet_slug))
  where lead_magnet_slug is not null;
