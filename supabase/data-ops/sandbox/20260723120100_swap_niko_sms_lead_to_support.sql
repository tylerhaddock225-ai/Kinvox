-- SMS-2b rail-swap B — move Niko's Twilio trial number LEAD → SUPPORT (revert A).
-- ⚠ PREPARED, NOT APPLIED. Run on request to restore the SUPPORT-rail default
-- after a lead-rail live test.
--
-- Reverse of 20260723120000_swap_niko_sms_support_to_lead.sql. Single atomic
-- UPDATE: lead → NULL, support → +17372324091. Guard (sms_lead_number = the
-- number) makes it a safe no-op if already on support.
--
-- SANDBOX ONLY (org id is sandbox-specific); never run on prod.

begin;

update public.organizations
   set sms_lead_number    = NULL,
       sms_support_number = '+17372324091'
 where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3'
   and sms_lead_number = '+17372324091';

commit;

-- Verify (run separately / via API):
--   select id, name, sms_support_number, sms_lead_number
--     from public.organizations
--    where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3';
--   -- expect: sms_support_number = +17372324091, sms_lead_number = NULL
