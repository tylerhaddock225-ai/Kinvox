BEGIN;

ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS inbound_email_from text;

COMMENT ON COLUMN public.ticket_messages.inbound_email_from IS
  'Sender email captured at inbound webhook time. Used as outbound reply-to fallback when ticket has no customer_id. Only populated for inbound messages; null for org-user outbound and internal notes.';

COMMIT;
