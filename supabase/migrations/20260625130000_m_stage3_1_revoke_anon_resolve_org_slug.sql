-- Stage 3 left resolve_org_slug with the Supabase-default anon:EXECUTE grant intact
-- (revoke ... from public does not remove role-specific grants). The function is
-- SECURITY DEFINER, so an anonymous caller could resolve a slug from a known org UUID,
-- bypassing the TO-authenticated RLS on organizations. Restrict to authenticated.
revoke execute on function public.resolve_org_slug(uuid) from anon;
