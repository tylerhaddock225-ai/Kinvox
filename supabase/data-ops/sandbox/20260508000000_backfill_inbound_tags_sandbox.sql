-- Kinvox Workstream A Phase A1 — backfill existing inbound tags to the
-- new <channel>-<orgSlug> format.
--
-- Phase A1 introduces auto-mint of inbound_email_tag / inbound_lead_email_tag
-- on email verification, with a new format:
--   support-<orgSlug>   (was: <name-slug>-<4charhash>)
--   lead-<orgSlug>      (same)
--
-- The Phase A1 stickiness invariant says we don't rewrite existing tags in
-- general (live customers may have configured forwarding rules pointing at
-- the original address). Sandbox is the exception: no live customers, no
-- external forwarding rules to break, and we want format consistency for
-- end-to-end testing.
--
-- WHERE clause uses slug (not org id) so this is environment-portable: it
-- silently no-ops on any environment where the slug doesn't exist. Both
-- updates are guarded with IS NOT NULL so the migration is idempotent.
-- Production has no Niko org, so this migration is a safe no-op there.

update public.organizations
   set inbound_email_tag = 'support-niko-s-storm-protection'
 where slug = 'niko-s-storm-protection'
   and inbound_email_tag is not null;

update public.organizations
   set inbound_lead_email_tag = 'lead-niko-s-storm-protection'
 where slug = 'niko-s-storm-protection'
   and inbound_lead_email_tag is not null;
