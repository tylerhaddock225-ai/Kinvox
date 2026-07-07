-- WORKSTREAM SEC-1 — Lock down anon-executable SECURITY DEFINER RPCs.
--
-- Audit finding (CRITICAL/HIGH): five service-role-only SECURITY DEFINER
-- functions were EXECUTE-granted to anon + authenticated (the Supabase
-- default blanket grant) despite having NO internal caller authorization.
-- That made them callable over PostgREST /rest/v1/rpc by anyone holding the
-- public anon key:
--   add_credits                 → mint unlimited credits for any org (Stripe bypass)
--   deduct_credit               → drain any org's credit balance
--   record_outbound_send        → drain balance (caller-controlled charge) + corrupt state
--   get_decrypted_credential    → exfiltrate any org's decrypted vault OAuth token
--   set_organization_credential → overwrite any org's stored credential
--
-- Every in-repo call site uses the service_role admin client (verified), so
-- revoking anon/authenticated blocks ONLY external PostgREST /rpc calls — the
-- hole — while leaving the legitimate admin path intact. Internal SQL callers
-- inside other SECDEF functions/triggers run in owner context and are
-- unaffected by these grants.
--
-- Also pins search_path on these five plus the other flagged SECDEF functions
-- (is_admin_hq / handle_new_user / auth_user_view_leads) per audit finding M4.
-- get_support_stats is intentionally NOT touched here — it needs an internal
-- org-scope check, handled in a later batch.

-- 1) Remove default/public + anon + authenticated EXECUTE on the five
--    service-role-only SECDEF RPCs.
revoke execute on function public.add_credits(p_org_id uuid, p_amount integer, p_ext_ref text) from public, anon, authenticated;
revoke execute on function public.deduct_credit(org_id uuid, amount integer, ref_id uuid) from public, anon, authenticated;
revoke execute on function public.record_outbound_send(p_outbound_id uuid, p_external_post_id text, p_charge integer) from public, anon, authenticated;
revoke execute on function public.get_decrypted_credential(p_org_id uuid, p_platform social_platform) from public, anon, authenticated;
revoke execute on function public.set_organization_credential(p_org_id uuid, p_platform social_platform, p_token text, p_handle text, p_scopes text[], p_expires_at timestamp with time zone, p_created_by uuid) from public, anon, authenticated;

-- 2) Guarantee the admin (service_role) call path is preserved.
grant execute on function public.add_credits(p_org_id uuid, p_amount integer, p_ext_ref text) to service_role;
grant execute on function public.deduct_credit(org_id uuid, amount integer, ref_id uuid) to service_role;
grant execute on function public.record_outbound_send(p_outbound_id uuid, p_external_post_id text, p_charge integer) to service_role;
grant execute on function public.get_decrypted_credential(p_org_id uuid, p_platform social_platform) to service_role;
grant execute on function public.set_organization_credential(p_org_id uuid, p_platform social_platform, p_token text, p_handle text, p_scopes text[], p_expires_at timestamp with time zone, p_created_by uuid) to service_role;

-- 3) Pin search_path on the five above AND on the other flagged SECDEF
--    functions (M4 hardening). The five targets already carry this pin; the
--    re-set is an idempotent no-op. The three zero-arg helpers below are the
--    ones that actually change state.
alter function public.add_credits(p_org_id uuid, p_amount integer, p_ext_ref text) set search_path = public, pg_temp;
alter function public.deduct_credit(org_id uuid, amount integer, ref_id uuid) set search_path = public, pg_temp;
alter function public.record_outbound_send(p_outbound_id uuid, p_external_post_id text, p_charge integer) set search_path = public, pg_temp;
alter function public.get_decrypted_credential(p_org_id uuid, p_platform social_platform) set search_path = public, pg_temp;
alter function public.set_organization_credential(p_org_id uuid, p_platform social_platform, p_token text, p_handle text, p_scopes text[], p_expires_at timestamp with time zone, p_created_by uuid) set search_path = public, pg_temp;
alter function public.is_admin_hq() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.auth_user_view_leads() set search_path = public, pg_temp;
