
-- Remove the broad SELECT policy that lets clients LIST every file in
-- the avatars bucket. Direct public URLs continue to work because the
-- bucket itself is public.
DROP POLICY IF EXISTS "Anyone can read avatars" ON storage.objects;
