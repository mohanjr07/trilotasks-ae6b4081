-- =========================================================================
-- Payments feature
-- =========================================================================
-- Anyone can request a payment (attach a bill, pick a project, state the
-- purpose and amount). Admins approve/reject. Accountants (identified by
-- profiles.department = 'Accountant') can see every request read-only and
-- are notified — in-app and by email, reusing the existing notification +
-- email pipeline — the moment a request they need to pay out is approved.
-- =========================================================================

-- 1. Table
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id),
  project_id uuid REFERENCES public.projects(id),
  purpose text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  bill_path text NOT NULL,
  bill_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- Helper: is this user an accountant? (mirrors public.is_admin)
CREATE OR REPLACE FUNCTION public.is_accountant(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND lower(coalesce(department, '')) = 'accountant'
  )
$$;

-- 2. Policies
DROP POLICY IF EXISTS "pr_requester_insert" ON public.payment_requests;
CREATE POLICY "pr_requester_insert" ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());

DROP POLICY IF EXISTS "pr_requester_select_own" ON public.payment_requests;
CREATE POLICY "pr_requester_select_own" ON public.payment_requests
  FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.is_accountant(auth.uid())
  );

DROP POLICY IF EXISTS "pr_admin_update" ON public.payment_requests;
CREATE POLICY "pr_admin_update" ON public.payment_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "pr_requester_delete_own_pending" ON public.payment_requests;
CREATE POLICY "pr_requester_delete_own_pending" ON public.payment_requests
  FOR DELETE TO authenticated
  USING (requester_id = auth.uid() AND status = 'pending');

-- 3. Storage bucket for the attached bills (private — financial documents)
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-bills', 'payment-bills', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "payment_bills_insert" ON storage.objects;
CREATE POLICY "payment_bills_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-bills' AND auth.uid() IS NOT NULL);

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
        WHERE pr.bill_path = storage.objects.name AND pr.requester_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "payment_bills_delete" ON storage.objects;
CREATE POLICY "payment_bills_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'payment-bills' AND public.is_admin(auth.uid()));

-- 4. Allow a 'payment' notification type
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('task','leave','system','payment'));

-- 5. Notify admins when a payment is requested
CREATE OR REPLACE FUNCTION public.notify_payment_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_name text;
  admin_id uuid;
BEGIN
  SELECT full_name INTO requester_name FROM profiles WHERE id = NEW.requester_id;

  FOR admin_id IN SELECT id FROM profiles WHERE role IN ('admin','super_admin') AND id != NEW.requester_id
  LOOP
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (
      admin_id,
      'New payment request',
      coalesce(requester_name, 'Someone') || ' requested ₹' || NEW.amount || ' — ' || NEW.purpose,
      'payment',
      NEW.id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment_requested ON public.payment_requests;
CREATE TRIGGER trg_notify_payment_requested
AFTER INSERT ON public.payment_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_payment_requested();

-- 6. Notify the requester (always) and every accountant (on approval only)
-- when an admin reviews the request.
CREATE OR REPLACE FUNCTION public.notify_payment_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_name text;
  accountant_id uuid;
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved','rejected') THEN
    -- Requester always hears back.
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (
      NEW.requester_id,
      CASE WHEN NEW.status = 'approved' THEN 'Payment request approved ✓' ELSE 'Payment request rejected' END,
      'Your request for ₹' || NEW.amount || ' (' || NEW.purpose || ')' ||
        CASE WHEN NEW.status = 'approved' THEN ' was approved.'
        ELSE ' was rejected.' || coalesce(' ' || NEW.review_note, '') END,
      'payment',
      NEW.id
    );

    -- Accountants only need to hear about approved ones — that's their cue to pay out.
    IF NEW.status = 'approved' THEN
      SELECT full_name INTO requester_name FROM profiles WHERE id = NEW.requester_id;

      FOR accountant_id IN SELECT id FROM profiles WHERE lower(coalesce(department, '')) = 'accountant'
      LOOP
        INSERT INTO notifications (user_id, title, body, type, reference_id)
        VALUES (
          accountant_id,
          'Payment approved — ready to process',
          coalesce(requester_name, 'A request') || '''s payment of ₹' || NEW.amount ||
            ' for "' || NEW.purpose || '" was approved and is ready to be paid out.',
          'payment',
          NEW.id
        );
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment_reviewed ON public.payment_requests;
CREATE TRIGGER trg_notify_payment_reviewed
AFTER UPDATE ON public.payment_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_payment_reviewed();
