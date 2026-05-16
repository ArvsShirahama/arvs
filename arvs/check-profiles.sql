-- Check if profiles exist and have data
SELECT 
  id,
  username,
  display_name,
  avatar_url,
  last_seen,
  created_at
FROM public.profiles
ORDER BY created_at DESC;

-- Count total profiles
SELECT COUNT(*) as total_profiles FROM public.profiles;

-- Check if auth users have corresponding profiles
SELECT 
  au.email,
  au.created_at as auth_created,
  p.username,
  p.display_name,
  p.created_at as profile_created
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
ORDER BY au.created_at DESC;
