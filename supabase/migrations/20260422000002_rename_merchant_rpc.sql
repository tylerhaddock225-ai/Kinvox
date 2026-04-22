-- Brand alignment: merchant → organization. The approve RPC keeps its
-- signature (uuid → uuid) and its SECURITY DEFINER + search_path setup;
-- only the function name and the error-message string change.
--
-- No triggers call this function (checked against the baseline schema);
-- it's invoked via supabase.rpc() from the HQ applications action only,
-- which is updated in the same commit.
--
-- ALTER FUNCTION … RENAME preserves existing ACLs, so no re-GRANT is
-- needed — but we re-assert the REVOKE/GRANT under the new name for
-- explicitness so the migration is re-runnable on a fresh DB that
-- has the old name dropped manually.

alter function public.approve_merchant_application(uuid)
  rename to approve_organization_application;

-- Refresh the internal error message to match the new name.
create or replace function public.approve_organization_application(application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role       text;
  v_app        public.applications%rowtype;
  v_org_id     uuid;
  v_base_slug  text;
  v_slug       text;
  v_counter    int := 2;
begin
  select system_role into v_role from public.profiles where id = auth.uid();
  if v_role is null or left(v_role, 9) <> 'platform_' then
    raise exception 'approve_organization_application: access denied' using errcode = '42501';
  end if;

  select * into v_app from public.applications where id = application_id for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if v_app.status = 'approved' then
    raise exception 'application already approved' using errcode = '23505';
  end if;

  v_base_slug := regexp_replace(lower(trim(v_app.business_name)), '[^a-z0-9]+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  if v_base_slug = '' then v_base_slug := 'org'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_slug := v_base_slug || '-' || v_counter;
    v_counter := v_counter + 1;
  end loop;

  insert into public.organizations (name, slug, owner_id, website)
  values (v_app.business_name, v_slug, auth.uid(), v_app.website)
  returning id into v_org_id;

  update public.applications
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid()
  where id = application_id;

  return v_org_id;
end;
$$;

revoke all on function public.approve_organization_application(uuid) from public;
grant execute on function public.approve_organization_application(uuid) to authenticated;
