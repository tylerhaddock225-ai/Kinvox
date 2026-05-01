-- Kinvox — split the inbound forwarding address into per-channel tags.
--
-- Path A (Postmark plus-addressing). inbound.kinvoxtech.com has no MX
-- records yet, so the support-side feature has been minting addresses
-- pointing at a domain that swallows mail. Going forward, inbound mail
-- routes through Postmark's per-server inbound mailbox using
-- plus-addressing: `<server-hash>+<tenant-tag>@inbound.postmarkapp.com`.
-- The DB now stores ONLY the <tenant-tag> portion; the full address is
-- assembled at display/use time from process.env.POSTMARK_INBOUND_ADDRESS.
--
-- Two channels = two tag columns:
--   inbound_email_tag       (renamed from inbound_email_address) — Tickets
--   inbound_lead_email_tag  (new)                                — Leads
--
-- Side effect: orgs that previously had verified_lead_email equal to
-- verified_support_email get the lead pair NULL'd. App-level validation
-- being added in this same prompt rejects the equality going forward.

-- ── 1) Drop the old support-side index BEFORE renaming the column. ──────────
-- (PostgreSQL preserves the index across a column rename, but we want to
--  rename the index too for naming parity with the new lead-tag index.)
drop index if exists public.organizations_inbound_email_unique;

-- ── 2) Rename the existing column from full-address to tag-only semantics. ─
alter table public.organizations
  rename column inbound_email_address to inbound_email_tag;

-- ── 3) Strip the "@<domain>" suffix from any pre-existing values, leaving
--       just the tag. split_part returns the input unchanged when there's
--       no '@', so this is safe for both legacy full-address rows and any
--       row that's already tag-only.
update public.organizations
   set inbound_email_tag = split_part(inbound_email_tag, '@', 1)
 where inbound_email_tag is not null;

-- ── 4) Recreate the unique partial index with a parity name. ────────────────
create unique index organizations_inbound_email_tag_unique
  on public.organizations using btree (lower(inbound_email_tag))
  where (inbound_email_tag is not null);

-- ── 5) Add the new lead-channel tag column + matching unique partial index. ─
alter table public.organizations
  add column if not exists inbound_lead_email_tag text;

create unique index if not exists organizations_inbound_lead_email_tag_unique
  on public.organizations using btree (lower(inbound_lead_email_tag))
  where (inbound_lead_email_tag is not null);

-- ── 6) Defensive consistency on the verified-email channels. ────────────────
-- Channel split requires the lead and support emails to be DIFFERENT
-- addresses (each gets its own Postmark Sender Signature). Any org where
-- the two channels currently point at the same address gets the lead pair
-- nulled — the user must re-verify a distinct address through the UI.
update public.organizations
   set verified_lead_email              = null,
       verified_lead_email_confirmed_at = null
 where verified_lead_email is not null
   and verified_lead_email = verified_support_email;

-- And: a confirmation timestamp without an email is meaningless. This
-- can happen if a previous flow nulled the address but left the timestamp
-- behind; clean it up.
update public.organizations
   set verified_lead_email_confirmed_at = null
 where verified_lead_email_confirmed_at is not null
   and verified_lead_email is null;

-- ── Comments for future readers. ────────────────────────────────────────────
comment on column public.organizations.inbound_email_tag is
  'Per-tenant tag used in Postmark plus-addressing for the SUPPORT/Tickets '
  'inbound channel. Full address is assembled at runtime as '
  '<POSTMARK_INBOUND_ADDRESS local-part>+<tag>@<domain>.';
comment on column public.organizations.inbound_lead_email_tag is
  'Per-tenant tag used in Postmark plus-addressing for the LEAD inbound '
  'channel. Same construction as inbound_email_tag, distinct so support '
  'and lead replies route to different conversation surfaces.';
