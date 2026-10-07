-- Design Validation: requester picks the approver — Harish Kanna MK or Saravanan (same as Quality Check)
CREATE OR REPLACE FUNCTION public._form_approver_allowed(p_title text, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_title ~* '(quality\s*check|design\s*validation)' THEN EXISTS (
      SELECT 1 FROM public.profiles WHERE id = p_user
        AND (lower(email) = 'harishkanna@triloautomation.com' OR full_name ILIKE 'saravanan%'))
    ELSE false
  END
$$;
