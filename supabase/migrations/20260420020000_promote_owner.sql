UPDATE public.profiles
   SET system_role = 'platform_owner'
 WHERE id IN (
   SELECT id FROM auth.users WHERE email = 'tyler@kinvoxtech.com'
 );
