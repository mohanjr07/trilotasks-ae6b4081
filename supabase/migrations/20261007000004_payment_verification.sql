-- ═══════════════════════════════════════════════════════════════════════
--  Payments: manager verification step
--    request (pick a manager) → manager verifies the bill → admins approve
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS verifier_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_status_check;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_status_check
  CHECK (status IN ('pending_verification','pending','approved','rejected'));
ALTER TABLE public.payment_requests ALTER COLUMN status SET DEFAULT 'pending_verification';

-- New requests must go to a manager for verification first
DROP POLICY IF EXISTS "pr_requester_insert" ON public.payment_requests;
CREATE POLICY "pr_requester_insert" ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND status = 'pending_verification'
    AND verifier_id IS NOT NULL AND verifier_id <> auth.uid()
  );

-- The chosen manager can see the request
DROP POLICY IF EXISTS "pr_requester_select_own" ON public.payment_requests;
CREATE POLICY "pr_requester_select_own" ON public.payment_requests
  FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid()
    OR verifier_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.is_accountant(auth.uid())
  );

-- Requester can withdraw while it's still waiting
DROP POLICY IF EXISTS "pr_requester_delete_own_pending" ON public.payment_requests;
CREATE POLICY "pr_requester_delete_own_pending" ON public.payment_requests
  FOR DELETE TO authenticated
  USING (requester_id = auth.uid() AND status IN ('pending_verification','pending'));

-- The chosen manager can open the bill
DROP POLICY IF EXISTS "payment_bills_read" ON storage.objects;
CREATE POLICY "payment_bills_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-bills'
    AND (
      public.is_admin(auth.uid())
      OR public.is_accountant(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.payment_requests pr
        WHERE pr.bill_path = storage.objects.name
          AND (pr.requester_id = auth.uid() OR pr.verifier_id = auth.uid())
      )
    )
  );

-- Who is told when a request is raised: the chosen manager (admins hear after verification)
CREATE OR REPLACE FUNCTION public.notify_payment_requested()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requester_name text;
  admin_id uuid;
BEGIN
  SELECT full_name INTO requester_name FROM profiles WHERE id = NEW.requester_id;
  IF NEW.status = 'pending_verification' AND NEW.verifier_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (NEW.verifier_id, 'Payment waiting for your verification',
      coalesce(requester_name, 'Someone') || ' requested ₹' || NEW.amount || ' — ' || NEW.purpose || '. Please check the bill.',
      'payment', NEW.id);
  ELSE
    FOR admin_id IN SELECT id FROM profiles WHERE role IN ('admin','super_admin') AND id != NEW.requester_id
    LOOP
      INSERT INTO notifications (user_id, title, body, type, reference_id)
      VALUES (admin_id, 'New payment request',
        coalesce(requester_name, 'Someone') || ' requested ₹' || NEW.amount || ' — ' || NEW.purpose, 'payment', NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- Status changes: verified → admins; rejected by manager → requester; admin decision → requester (+ accountants)
CREATE OR REPLACE FUNCTION public.notify_payment_reviewed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requester_name text;
  verifier_name  text;
  uid uuid;
BEGIN
  SELECT full_name INTO requester_name FROM profiles WHERE id = NEW.requester_id;

  IF OLD.status = 'pending_verification' AND NEW.status = 'pending' THEN
    SELECT full_name INTO verifier_name FROM profiles WHERE id = NEW.verifier_id;
    FOR uid IN SELECT id FROM profiles WHERE role IN ('admin','super_admin') AND id != NEW.requester_id
    LOOP
      INSERT INTO notifications (user_id, title, body, type, reference_id)
      VALUES (uid, 'Payment waiting for your approval',
        coalesce(requester_name, 'Someone') || ' requested ₹' || NEW.amount || ' — ' || NEW.purpose ||
          ' (bill verified by ' || coalesce(verifier_name, 'manager') || ')', 'payment', NEW.id);
    END LOOP;
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (NEW.requester_id, 'Payment bill verified ✓',
      'Your request for ₹' || NEW.amount || ' (' || NEW.purpose || ') was verified by ' ||
        coalesce(verifier_name, 'the manager') || ' and is now waiting for admin approval.', 'payment', NEW.id);

  ELSIF OLD.status = 'pending_verification' AND NEW.status = 'rejected' THEN
    SELECT full_name INTO verifier_name FROM profiles WHERE id = NEW.verifier_id;
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (NEW.requester_id, 'Payment request rejected',
      'Your request for ₹' || NEW.amount || ' (' || NEW.purpose || ') was rejected by ' ||
        coalesce(verifier_name, 'the manager') || '.' || coalesce(' ' || NEW.review_note, ''), 'payment', NEW.id);

  ELSIF OLD.status = 'pending' AND NEW.status IN ('approved','rejected') THEN
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (NEW.requester_id,
      CASE WHEN NEW.status = 'approved' THEN 'Payment request approved ✓' ELSE 'Payment request rejected' END,
      'Your request for ₹' || NEW.amount || ' (' || NEW.purpose || ')' ||
        CASE WHEN NEW.status = 'approved' THEN ' was approved.' ELSE ' was rejected.' || coalesce(' ' || NEW.review_note, '') END,
      'payment', NEW.id);
    IF NEW.verifier_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, title, body, type, reference_id)
      VALUES (NEW.verifier_id,
        CASE WHEN NEW.status = 'approved' THEN 'Payment approved ✓' ELSE 'Payment rejected by admin' END,
        coalesce(requester_name, 'A request') || '''s ₹' || NEW.amount || ' (' || NEW.purpose || ') that you verified was ' || NEW.status || '.',
        'payment', NEW.id);
    END IF;
    IF NEW.status = 'approved' THEN
      FOR uid IN SELECT id FROM profiles WHERE lower(coalesce(department, '')) = 'accountant'
      LOOP
        INSERT INTO notifications (user_id, title, body, type, reference_id)
        VALUES (uid, 'Payment approved — ready to process',
          coalesce(requester_name, 'A request') || '''s payment of ₹' || NEW.amount ||
            ' for "' || NEW.purpose || '" was approved and is ready to be paid out.', 'payment', NEW.id);
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The chosen manager verifies (or rejects with a reason)
CREATE OR REPLACE FUNCTION public.verify_payment_request(p_id uuid, p_ok boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.verifier_id IS DISTINCT FROM auth.uid() OR r.status <> 'pending_verification' THEN
    RAISE EXCEPTION 'This request is not waiting for your verification';
  END IF;
  IF p_ok THEN
    UPDATE public.payment_requests SET status = 'pending', verified_at = now() WHERE id = p_id;
  ELSE
    IF coalesce(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Please give a reason for rejecting'; END IF;
    UPDATE public.payment_requests
       SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = trim(p_note)
     WHERE id = p_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verify_payment_request(uuid, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_payment_request(uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
