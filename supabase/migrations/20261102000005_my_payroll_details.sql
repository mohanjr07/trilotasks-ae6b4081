-- Everyone fills their own payroll details in Profile (Employee ID, Position, Date of Joining,
-- PAN, Account Number, IFSC). Anu's payslip form pulls them when she picks the employee.
CREATE OR REPLACE FUNCTION public.save_my_payroll_details(p_employee_code text, p_position text, p_joined date,
                                                          p_pan text, p_account text, p_ifsc text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  UPDATE public.profiles
     SET employee_code = nullif(trim(coalesce(p_employee_code, '')), ''),
         position      = nullif(trim(coalesce(p_position, '')), ''),
         joined_at     = p_joined
   WHERE id = auth.uid();
  INSERT INTO public.payroll_details (user_id, pan_number, account_number, ifsc_code, updated_by, updated_at)
  VALUES (auth.uid(), nullif(upper(trim(coalesce(p_pan, ''))), ''), nullif(trim(coalesce(p_account, '')), ''),
          nullif(upper(trim(coalesce(p_ifsc, ''))), ''), auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE
     SET pan_number = EXCLUDED.pan_number, account_number = EXCLUDED.account_number, ifsc_code = EXCLUDED.ifsc_code,
         updated_by = auth.uid(), updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_my_payroll_details(text, text, date, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.save_my_payroll_details(text, text, date, text, text, text) TO authenticated;

-- one call that returns everything the payslip needs for a person (self, Anu or admins)
CREATE OR REPLACE FUNCTION public.payroll_profile(p_user uuid)
RETURNS TABLE (employee_code text, "position" text, joined_at date, pan_number text, account_number text, ifsc_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.employee_code, p.position, p.joined_at::date, d.pan_number, d.account_number, d.ifsc_code
    FROM public.profiles p LEFT JOIN public.payroll_details d ON d.user_id = p.id
   WHERE p.id = p_user AND (p_user = auth.uid() OR public.is_payroll_viewer(auth.uid()))
$$;
REVOKE EXECUTE ON FUNCTION public.payroll_profile(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.payroll_profile(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
