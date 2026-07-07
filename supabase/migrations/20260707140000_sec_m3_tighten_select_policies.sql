-- SEC-M3 (audit M3): public.ai_templates and public.platform_settings each had a SELECT policy
-- with qual = true for the `authenticated` role → ANY logged-in tenant could read ALL rows via
-- PostgREST, exposing ai_templates.base_prompt (proprietary prompt IP) and every platform_settings
-- value. Both tables are GLOBAL (no organization_id column).
--
-- Fix: DROP the permissive qual=true SELECT policies (RLS policies OR-combine, so a permissive
-- true policy must be DROPPED, not merely supplemented) and replace each with
-- "HQ (is_admin_hq()) OR the specific thing the tenant legitimately needs at runtime".
-- This preserves the ONLY authenticated-tenant readers (verified by audit):
--   - ai_templates:      src/lib/ai-runtime.ts (via api/organization/ai-features, merchant JWT) —
--                        reads exactly the org's assigned template (organizations.ai_template_id).
--   - platform_settings: src/app/(app)/(dashboard)/[orgSlug]/hq-support/page.tsx — reads the two
--                        UI-toggle keys show_affected_tab_field / show_record_id_field.
-- Every other reader is an HQ surface (satisfies is_admin_hq()) or uses the service-role admin
-- client / a SECURITY DEFINER trigger (both bypass RLS), so none break.

-- Helper: resolve the caller's own org's assigned template id, RLS-independent (SECURITY DEFINER),
-- so the ai_templates policy's own-org branch cannot be blocked by organizations RLS in tenant
-- context. Mirrors the existing auth_user_org_id() shape (sql, secdef, pinned search_path).
create or replace function public.current_org_ai_template_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select o.ai_template_id
  from public.organizations o
  where o.id = public.auth_user_org_id()
$function$;

revoke execute on function public.current_org_ai_template_id() from public, anon;
grant  execute on function public.current_org_ai_template_id() to authenticated;

-- ai_templates: drop qual=true SELECT, replace with HQ-or-own-assigned-template.
drop policy "ai_templates: read authenticated" on public.ai_templates;
create policy "ai_templates: read hq or assigned template"
  on public.ai_templates for select to authenticated
  using (
    public.is_admin_hq()
    or ai_templates.id = public.current_org_ai_template_id()
  );

-- platform_settings: drop qual=true SELECT, replace with HQ-or-public-toggle-keys.
drop policy "Authenticated can read platform_settings" on public.platform_settings;
create policy "platform_settings: read hq or public toggles"
  on public.platform_settings for select to authenticated
  using (
    public.is_admin_hq()
    or platform_settings.key in ('show_affected_tab_field', 'show_record_id_field')
  );
