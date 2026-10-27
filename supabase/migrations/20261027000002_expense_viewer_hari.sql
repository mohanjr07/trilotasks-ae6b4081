-- Hari (hari@triloautomation.com) can see project expense tracking like admins:
-- read every payment request and open its bill / receipt. View only — approving,
-- paying and deleting stay as before.
CREATE OR REPLACE FUNCTION public.is_expense_viewer(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND lower(email) IN ('hari@triloautomation.com'))
$$;
REVOKE EXECUTE ON FUNCTION public.is_expense_viewer(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_expense_viewer(uuid) TO authenticated;

DROP POLICY IF EXISTS "pr_expense_viewer_select" ON public.payment_requests;
CREATE POLICY "pr_expense_viewer_select" ON public.payment_requests
  FOR SELECT TO authenticated USING (public.is_expense_viewer(auth.uid()));

DROP POLICY IF EXISTS "payment_bills_expense_viewer_read" ON storage.objects;
CREATE POLICY "payment_bills_expense_viewer_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'payment-bills' AND public.is_expense_viewer(auth.uid()));

NOTIFY pgrst, 'reload schema';
