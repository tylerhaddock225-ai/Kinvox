-- SMS-2b phone backfill — normalize existing phones to E.164 (SANDBOX ONLY).
--
-- The SMS inbound rail routes by EXACT E.164 phone match (customers.phone /
-- leads.phone = the sender's From). Rows written before SMS-0's normalize-on-write
-- hold whatever the user typed, so they'd never phone-match. This backfills them
-- using the same simple algorithm the inbound routing assumes:
--   strip non-digits; 10 digits → '+1'||d; 11 digits leading '1' → '+'||d;
--   anything else left UNTOUCHED (unparseable, e.g. '555').
-- Deliberately NOT libphonenumber (that lives in the app write path) — this is a
-- pure-SQL, deterministic pass. Fail-safe: only parseable rows change.
--
-- Applied via the Management API (sandbox ref ntwimeqxyyvjyrisqofl), NOT
-- run-data-op.mjs — the Supabase CLI can't run db query non-interactively here
-- (no DB password), same constraint as the SMS-1 / AD-2 ops above.
--
-- OUTCOME (2026-07-23): customers_updated = 0 (both non-null already E.164),
-- leads_updated = 19 (dry-run matched; '555' correctly untouched). Idempotent —
-- re-running changes 0 rows. NO-OP intent on prod; sandbox only.

begin;

update public.customers
   set phone = case
       when length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
         then '+1' || regexp_replace(phone, '[^0-9]', '', 'g')
       else '+'  || regexp_replace(phone, '[^0-9]', '', 'g')
     end
 where phone is not null
   and (
     (length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
        and phone <> '+1' || regexp_replace(phone, '[^0-9]', '', 'g'))
     or
     (length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11
        and left(regexp_replace(phone, '[^0-9]', '', 'g'), 1) = '1'
        and phone <> '+' || regexp_replace(phone, '[^0-9]', '', 'g'))
   );

update public.leads
   set phone = case
       when length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
         then '+1' || regexp_replace(phone, '[^0-9]', '', 'g')
       else '+'  || regexp_replace(phone, '[^0-9]', '', 'g')
     end
 where phone is not null
   and (
     (length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10
        and phone <> '+1' || regexp_replace(phone, '[^0-9]', '', 'g'))
     or
     (length(regexp_replace(phone, '[^0-9]', '', 'g')) = 11
        and left(regexp_replace(phone, '[^0-9]', '', 'g'), 1) = '1'
        and phone <> '+' || regexp_replace(phone, '[^0-9]', '', 'g'))
   );

commit;
