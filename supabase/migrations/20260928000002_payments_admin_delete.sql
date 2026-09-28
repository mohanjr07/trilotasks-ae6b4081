-- Admins can delete any payment request and its bill file
DROP POLICY IF EXISTS "pr_admin_delete" ON public.payment_requests;
CREATE POLICY "pr_admin_delete" ON public.payment_requests
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "payment_bills_admin_delete" ON storage.objects;
CREATE POLICY "payment_bills_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'payment-bills' AND public.is_admin(auth.uid()));
