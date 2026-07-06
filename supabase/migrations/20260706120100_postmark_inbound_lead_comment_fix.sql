-- Metadata-only: refresh the sibling organizations.inbound_lead_email_tag
-- column comment for the same reason as 20260706120000.
--
-- Its "Same construction as inbound_email_tag" pointer is now correct, but the
-- leading "Postmark plus-addressing" phrasing still describes the obsolete
-- inbound-hash model. Bring it in line with the localpart-forwarding mechanism
-- so support/lead comments are consistent and the topic is fully closed.
--
-- No schema / data / RLS change — COMMENT ON only.

comment on column public.organizations.inbound_lead_email_tag is
  'Per-tenant tag used as the localpart of the LEAD inbound forwarding address. Same construction as inbound_email_tag (<tag>@<POSTMARK_INBOUND_DOMAIN>), distinct so support and lead replies route to different conversation surfaces.';
