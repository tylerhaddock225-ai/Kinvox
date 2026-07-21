-- SMS Stage 0 — schema foundation for the SMS rail (outbound + inbound).
--
-- Pure additive schema + one CHECK widen. NOTHING reads these columns yet —
-- the SMS send/inbound consumers arrive in later SMS stages. No behavior change.
-- Mirrors the email rail's shape so the two channels stay symmetric:
--   * message rows gain a `channel` discriminator (email | sms), defaulting to
--     'email' so every existing row is correct without a backfill.
--   * SMS provenance gets first-class homes: lead_messages.inbound_from_phone +
--     provider_message_id (postmark_message_id stays email-only); ticket_messages
--     .inbound_from_phone, while the already-generic external_message_id is
--     documented as dual-use for the SMS provider message id.
--   * tickets.channel CHECK gains 'sms' ('phone' means voice; nothing branches
--     on this column today).
--   * organizations gains two per-org routing numbers (support + lead), the SMS
--     analog of inbound_email_tag / inbound_lead_email_tag — inbound routing will
--     resolve the org by exact E.164 match, so each gets a partial unique index.
--
-- RLS: unchanged. New columns inherit existing table policies; lead_messages and
-- ticket_messages remain service-role-write-only for system-authored rows.

begin;

-- ── 1) lead_messages — channel discriminator + SMS provenance ───────────────
alter table public.lead_messages
  add column channel text not null default 'email'
    constraint lead_messages_channel_check check (channel in ('email', 'sms')),
  add column inbound_from_phone text,
  add column provider_message_id text;

-- ── 2) ticket_messages — channel discriminator + SMS inbound-from phone ─────
alter table public.ticket_messages
  add column channel text not null default 'email'
    constraint ticket_messages_channel_check check (channel in ('email', 'sms')),
  add column inbound_from_phone text;

comment on column public.ticket_messages.external_message_id is
  'Provider message id (dual-use by channel). Email rows: Postmark MessageID. '
  'SMS rows: the SMS provider (Twilio-class) message SID. No separate '
  'provider_message_id column on this table — external_message_id already fits.';

-- ── 3) tickets.channel — widen CHECK to include 'sms' ──────────────────────
-- Existing constraint name confirmed via pg_constraint: tickets_channel_check.
-- Old set is a subset of the new set, so existing rows validate cleanly.
alter table public.tickets
  drop constraint tickets_channel_check;
alter table public.tickets
  add constraint tickets_channel_check
    check (channel in ('email', 'chat', 'phone', 'portal', 'manual', 'sms'));

-- ── 4) organizations — per-org SMS routing numbers (E.164) ─────────────────
-- The SMS analog of inbound_email_tag / inbound_lead_email_tag: one number per
-- rail. Inbound routing resolves the org by exact E.164 match, so each number
-- is globally unique when present (partial unique index mirrors the email-tag
-- unique indexes: organizations_inbound_email_tag_unique et al.).
alter table public.organizations
  add column sms_support_number text,
  add column sms_lead_number text;

create unique index organizations_sms_support_number_unique
  on public.organizations (sms_support_number)
  where sms_support_number is not null;

create unique index organizations_sms_lead_number_unique
  on public.organizations (sms_lead_number)
  where sms_lead_number is not null;

commit;
