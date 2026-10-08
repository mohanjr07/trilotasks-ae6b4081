-- Payments: Anu marks approved requests as paid → requester, verifier and approver are told
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES public.profiles(id);

CREATE OR REPLACE FUNCTION public.is_payment_payer(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND lower(email) = 'anu@triloautomation.com')
$$;

-- Anu sees every request and its bill
DROP POLICY IF EXISTS "pr_requester_select_own" ON public.payment_requests;
CREATE POLICY "pr_requester_select_own" ON public.payment_requests
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR verifier_id = auth.uid()
         OR public.is_admin(auth.uid()) OR public.is_accountant(auth.uid()) OR public.is_payment_payer(auth.uid()));

DROP POLICY IF EXISTS "payment_bills_read" ON storage.objects;
CREATE POLICY "payment_bills_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'payment-bills' AND (
    public.is_admin(auth.uid()) OR public.is_accountant(auth.uid()) OR public.is_payment_payer(auth.uid())
    OR EXISTS (SELECT 1 FROM public.payment_requests pr
               WHERE pr.bill_path = storage.objects.name
                 AND (pr.requester_id = auth.uid() OR pr.verifier_id = auth.uid()))));

-- Tell Anu when a request is approved (it's ready for her to pay)
CREATE OR REPLACE FUNCTION public.notify_payment_payer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_anu uuid; v_req text; v_appr text;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    SELECT id INTO v_anu FROM profiles
     WHERE lower(email) = 'anu@triloautomation.com'
       AND lower(coalesce(department, '')) <> 'accountant'   -- accountants are already told
     LIMIT 1;
    IF v_anu IS NOT NULL AND v_anu <> NEW.requester_id THEN
      SELECT full_name INTO v_req  FROM profiles WHERE id = NEW.requester_id;
      SELECT full_name INTO v_appr FROM profiles WHERE id = NEW.reviewed_by;
      INSERT INTO notifications (user_id, title, body, type, reference_id)
      VALUES (v_anu, 'Payment approved — please pay',
        coalesce(v_req, 'A request') || '''s ₹' || NEW.amount || ' for "' || NEW.purpose || '" was approved by ' ||
          coalesce(v_appr, 'admin') || '. Mark it as paid once done.', 'payment', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_payment_payer ON public.payment_requests;
CREATE TRIGGER trg_notify_payment_payer AFTER UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_payer();

-- Anu marks an approved request as paid (works for old approved requests too)
CREATE OR REPLACE FUNCTION public.mark_payment_paid(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_requests%ROWTYPE; v_me text; uid uuid;
BEGIN
  IF NOT public.is_payment_payer(auth.uid()) THEN
    RAISE EXCEPTION 'Only Accounts (Anu) can mark payments as paid';
  END IF;
  SELECT * INTO r FROM payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'Only approved requests can be paid'; END IF;
  IF r.paid_at IS NOT NULL THEN RAISE EXCEPTION 'Already marked as paid'; END IF;

  UPDATE payment_requests SET paid_at = now(), paid_by = auth.uid() WHERE id = p_id;
  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();

  FOR uid IN
    SELECT DISTINCT x FROM unnest(ARRAY[r.requester_id, r.verifier_id, r.reviewed_by]) x
    WHERE x IS NOT NULL AND x <> auth.uid()
  LOOP
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (uid, 'Payment done ✓',
      '₹' || r.amount || ' for "' || r.purpose || '" has been paid by ' || coalesce(v_me, 'Accounts') || '.',
      'payment', p_id);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_payment_paid(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mark_payment_paid(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_payment_payer(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_payment_payer(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
