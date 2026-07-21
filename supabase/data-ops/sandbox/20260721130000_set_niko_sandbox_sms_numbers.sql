-- SMS-1 sandbox test enablement (SANDBOX ONLY).
--
-- Give Niko's Storm Protection (6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3) an SMS
-- support sending number so Tyler can live-test the ticket-reply SMS toggle.
-- Uses the Twilio trial number (+17372324091). sms_lead_number is left NULL —
-- the lead rail is a later stage, and the trial account has only one number.
--
-- Idempotent: re-running sets the same value. The partial unique index on
-- sms_support_number means no other org may hold this number (sandbox-only,
-- single test org). NO-OP on prod (different org id there); never run on prod.

begin;

update public.organizations
   set sms_support_number = '+17372324091'
 where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3';

commit;

-- Verify (run separately / via API):
--   select id, name, sms_support_number, sms_lead_number
--     from public.organizations
--    where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3';
