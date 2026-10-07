-- Managers (and admins) skip the verification step: their payment requests go straight to the admins
DROP POLICY IF EXISTS "pr_requester_insert" ON public.payment_requests;
CREATE POLICY "pr_requester_insert" ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND (
      (status = 'pending_verification' AND verifier_id IS NOT NULL AND verifier_id <> auth.uid())
      OR (status = 'pending' AND verifier_id IS NULL
          AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('manager','admin','super_admin')))
    )
  );
NOTIFY pgrst, 'reload schema';
