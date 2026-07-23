-- SMS-2b rail-swap A — move Niko's Twilio trial number SUPPORT → LEAD.
-- ⚠ PREPARED, NOT APPLIED. Run on request to live-test the LEAD-rail SMS toggle.
--
-- The Twilio trial account has ONE number (+17372324091), currently on Niko's
-- SUPPORT rail (set by the SMS-1 op). To exercise lead-rail SMS (lead composer
-- toggle + lead inbound webhook), the same number must sit on the LEAD rail. This
-- moves it in a single atomic UPDATE: support → NULL, lead → +17372324091. The
-- guard (sms_support_number = the number) makes it a safe no-op if already moved.
--
-- Partial unique indexes: nulling support frees that column; no other org holds
-- the number on the lead column (all NULL), so the lead-column unique index is
-- satisfied. Reverse with 20260723120100_swap_niko_sms_lead_to_support.sql.
--
-- SANDBOX ONLY (org id is sandbox-specific); never run on prod.

begin;

update public.organizations
   set sms_support_number = NULL,
       sms_lead_number    = '+17372324091'
 where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3'
   and sms_support_number = '+17372324091';

commit;

-- Verify (run separately / via API):
--   select id, name, sms_support_number, sms_lead_number
--     from public.organizations
--    where id = '6fe9db41-7bf9-4a22-bb5a-4ec3035c5fb3';
--   -- expect: sms_support_number = NULL, sms_lead_number = +17372324091
