
-- Update is_admin function to also include manager role
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = uid AND role IN ('admin', 'manager', 'super_admin')
  )
$$;

-- Create a function to check if user is strictly admin (not manager) for user management
CREATE OR REPLACE FUNCTION public.is_strict_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = uid AND role IN ('admin', 'super_admin')
  )
$$;
