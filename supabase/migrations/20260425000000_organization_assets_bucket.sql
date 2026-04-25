-- Organization branding assets (logos, etc.).
--
-- Public bucket so that <img src="..."> in marketing/dashboard surfaces can
-- render without signed URLs. The bucket is hard-capped at 2MB and limited to
-- common raster image MIME types — PDF/SVG are intentionally excluded so the
-- bucket can never be used to host scripts or arbitrary documents.
--
-- Path convention: logos/<organization_id>/logo.<ext>
-- The org id is a surrogate UUID (NOT PII); no user-identifying info goes in
-- filenames or paths.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-assets',
  'organization-assets',
  true,
  2097152,                                 -- 2 MiB
  array['image/png', 'image/jpeg']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects: belt-and-suspenders. The server action uses the
-- service role to upload so these policies aren't strictly required, but
-- they make any future direct-from-browser upload safe by default.

drop policy if exists "organization-assets read"            on storage.objects;
drop policy if exists "organization-assets tenant insert"   on storage.objects;
drop policy if exists "organization-assets tenant update"   on storage.objects;
drop policy if exists "organization-assets tenant delete"   on storage.objects;

-- Public read: bucket is public; expose objects to anon + authenticated.
create policy "organization-assets read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'organization-assets');

-- Writes are scoped to logos/<your-org-id>/...
-- (storage.foldername(name)) splits the object path on '/'. Index 1 is
-- 'logos', index 2 is the org id. Using ::uuid forces a parse failure on
-- malformed paths, which fails the policy safely.
create policy "organization-assets tenant insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'organization-assets'
    and (storage.foldername(name))[1] = 'logos'
    and (storage.foldername(name))[2]::uuid = public.auth_user_org_id()
  );

create policy "organization-assets tenant update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'organization-assets'
    and (storage.foldername(name))[1] = 'logos'
    and (storage.foldername(name))[2]::uuid = public.auth_user_org_id()
  )
  with check (
    bucket_id = 'organization-assets'
    and (storage.foldername(name))[1] = 'logos'
    and (storage.foldername(name))[2]::uuid = public.auth_user_org_id()
  );

create policy "organization-assets tenant delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'organization-assets'
    and (storage.foldername(name))[1] = 'logos'
    and (storage.foldername(name))[2]::uuid = public.auth_user_org_id()
  );
