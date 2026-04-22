-- SECURITY DEFINER RPC to approve an incoming /apply submission.
-- Creates the org (with the reviewing admin as placeholder owner) and
-- stamps the application. Auth gate is inside the function body — the
-- caller's JWT is still readable via auth.uid() because we're a
-- DEFINER-owned function invoked from a SECURITY INVOKER-equivalent context.

create or replace function public.approve_merchant_application(application_id uuid)
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
  -- Platform-only. Check first so we fail fast without leaking row data.
  select system_role into v_role from public.profiles where id = auth.uid();
  if v_role is null or left(v_role, 9) <> 'platform_' then
    raise exception 'approve_merchant_application: access denied' using errcode = '42501';
  end if;

  -- Lock the row so two concurrent approves can't duplicate an org.
  select * into v_app from public.applications where id = application_id for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if v_app.status = 'approved' then
    raise exception 'application already approved' using errcode = '23505';
  end if;

  -- Slugify business_name: lowercase, non-alphanum → dash, trim dashes.
  v_base_slug := regexp_replace(lower(trim(v_app.business_name)), '[^a-z0-9]+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  if v_base_slug = '' then v_base_slug := 'org'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_slug := v_base_slug || '-' || v_counter;
    v_counter := v_counter + 1;
  end loop;

  -- Create the org. Reviewing admin is placeholder owner until the
  -- merchant signs up and ownership is transferred via a future flow.
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

revoke all on function public.approve_merchant_application(uuid) from public;
grant execute on function public.approve_merchant_application(uuid) to authenticated;
