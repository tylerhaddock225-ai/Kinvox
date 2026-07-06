-- Metadata-only: refresh the stale organizations.inbound_email_tag column
-- comment to match the live inbound mechanism.
--
-- The prior comment described an obsolete Postmark inbound-hash plus-addressing
-- model (<local-part>+<tag>@<domain>). The live mechanism is Postmark Inbound
-- Domain Forwarding: the per-tenant tag is the FULL localpart, and
-- constructInboundEmailAddress (src/lib/email/inbound-address.ts) assembles
-- <tag>@<POSTMARK_INBOUND_DOMAIN>.
--
-- No schema / data / RLS change — COMMENT ON only.

comment on column public.organizations.inbound_email_tag is
  'Per-tenant tag used as the localpart of the SUPPORT/Tickets inbound forwarding address. The full address is assembled at runtime as <tag>@<POSTMARK_INBOUND_DOMAIN> (see src/lib/email/inbound-address.ts).';
