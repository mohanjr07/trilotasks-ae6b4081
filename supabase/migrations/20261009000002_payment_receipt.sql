-- Payments: Anu uploads the payment receipt when marking a request as paid
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS receipt_name text;

-- requester, verifier and the approving admin can open the receipt (admins / accounts / Anu see everything)
DROP POLICY IF EXISTS "payment_bills_read" ON storage.objects;
CREATE POLICY "payment_bills_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-bills' AND (
    public.is_admin(auth.uid()) OR public.is_accountant(auth.uid()) OR public.is_payment_payer(auth.uid())
    OR EXISTS (SELECT 1 FROM public.payment_requests pr
               WHERE (pr.bill_path = storage.objects.name OR pr.receipt_path = storage.objects.name)
                 AND (pr.requester_id = auth.uid() OR pr.verifier_id = auth.uid() OR pr.reviewed_by = auth.uid()))));

DROP FUNCTION IF EXISTS public.mark_payment_paid(uuid);
CREATE OR REPLACE FUNCTION public.mark_payment_paid(p_id uuid, p_receipt_path text, p_receipt_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_requests%ROWTYPE; v_me text; uid uuid;
BEGIN
  IF NOT public.is_payment_payer(auth.uid()) THEN
    RAISE EXCEPTION 'Only Accounts (Anu) can mark payments as paid';
  END IF;
  IF coalesce(trim(p_receipt_path), '') = '' THEN RAISE EXCEPTION 'Upload the payment receipt'; END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'Only approved requests can be paid'; END IF;
  IF r.paid_at IS NOT NULL THEN RAISE EXCEPTION 'Already marked as paid'; END IF;

  UPDATE payment_requests
     SET paid_at = now(), paid_by = auth.uid(), receipt_path = p_receipt_path, receipt_name = p_receipt_name
   WHERE id = p_id;
  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();

  FOR uid IN
    SELECT DISTINCT x FROM unnest(ARRAY[r.requester_id, r.verifier_id, r.reviewed_by]) x
    WHERE x IS NOT NULL AND x <> auth.uid()
  LOOP
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (uid, 'Payment done ✓',
      '₹' || r.amount || ' for "' || r.purpose || '" has been paid by ' || coalesce(v_me, 'Accounts') ||
        '. The payment receipt is attached in Payments.', 'payment', p_id);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_payment_paid(uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mark_payment_paid(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
