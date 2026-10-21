-- Project names for the Material IN / OUT "Project" dropdown — every project, for every signed-in user.
CREATE OR REPLACE FUNCTION public.form_project_names()
RETURNS TABLE (name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.name FROM public.projects p WHERE auth.uid() IS NOT NULL AND p.name IS NOT NULL ORDER BY p.name
$$;
REVOKE EXECUTE ON FUNCTION public.form_project_names() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.form_project_names() TO authenticated;
NOTIFY pgrst, 'reload schema';
