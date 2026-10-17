-- Forms: "Approved by" can be any active manager, plus the usual approver for the form
-- (Anu asset/expense, Harish QC/DV, Hari otherwise) and Saravanan for QC/DV.
CREATE OR REPLACE FUNCTION public._form_approver_allowed(p_title text, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user AND coalesce(p.is_active, true)
       AND (
         p.role = 'manager'
         OR lower(p.email) = CASE
              WHEN p_title ~* '(asset|expense)' THEN 'anu@triloautomation.com'
              WHEN p_title ~* '(quality\s*check|design\s*validation)' THEN 'harishkanna@triloautomation.com'
              ELSE 'hari@triloautomation.com' END
         OR (p_title ~* '(quality\s*check|design\s*validation)' AND p.full_name ILIKE 'saravanan%')
       )
  )
$$;
REVOKE EXECUTE ON FUNCTION public._form_approver_allowed(text, uuid) FROM anon, public;
NOTIFY pgrst, 'reload schema';
