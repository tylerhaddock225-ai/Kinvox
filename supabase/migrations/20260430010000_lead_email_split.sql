-- Kinvox — Split the single verified_support_email field into two
-- parallel verification channels.
--
-- Background: organizations.verified_support_email was overloaded as both
-- (a) the From address + recipient for lead-magnet flows AND (b) the
-- support-tickets address. Org owners reasonably expect those to be two
-- different addresses (sales@org.com vs support@org.com). This migration
-- introduces a parallel pair of columns for the lead-domain channel; the
-- existing support pair is unchanged and now owns support tickets only.
--
-- Backfill: existing orgs that have a verified support email keep working
-- without any manual re-verification. The lead-email columns are seeded
-- from the support pair so the lead-magnet pipeline stays live across
-- the migration window.

alter table public.organizations
  add column if not exists verified_lead_email              text;

alter table public.organizations
  add column if not exists verified_lead_email_confirmed_at timestamptz;

comment on column public.organizations.verified_lead_email is
  'Customer-facing From address for lead-magnet confirmation emails AND '
  'recipient for new-lead alerts. Independent of verified_support_email '
  '(which is the support-tickets channel). NULL means no lead-email is '
  'configured; the lead-magnet flows fall back to the Kinvox shared '
  'mailbox.';

comment on column public.organizations.verified_lead_email_confirmed_at is
  'Timestamp at which Postmark confirmed verified_lead_email as a Sender '
  'Signature. NULL means pending — the From address falls back to the '
  'Kinvox shared mailbox and the new-lead alert is suppressed until the '
  'Organization completes the Postmark verification.';

-- Backfill existing orgs that already have a verified support email so
-- their lead-magnet pipeline continues to work post-deploy without manual
-- re-verification. Only orgs whose support email is non-null are touched;
-- orgs that never set one leave the new columns null.
update public.organizations
   set verified_lead_email              = verified_support_email,
       verified_lead_email_confirmed_at = verified_support_email_confirmed_at
 where verified_support_email is not null
   and verified_lead_email     is null;
