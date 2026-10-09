-- ═══ TaskFlow: everything since the digital forms (safe to run more than once) ═══

-- ───────── 20261006000003_form_refs.sql ─────────
-- Reference-number pickers: every running number issued on any form
-- (old "Use This" opens + digital requests), newest first.
CREATE OR REPLACE FUNCTION public.form_refs()
RETURNS TABLE(reference_value text, form_title text, project text, issued_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.reference_value,
         f.title,
         (SELECT coalesce(fr.data->'fields'->>'project', fr.data->'fields'->>'project_name', fr.data->'fields'->>'project_title')
            FROM public.form_requests fr
           WHERE fr.form_id = f.id AND fr.reference_value = o.reference_value LIMIT 1) AS project,
         o.opened_at
  FROM public.production_form_opens o
  JOIN public.production_forms f ON f.id = o.form_id
  WHERE coalesce(o.reference_value, '') <> ''
  ORDER BY o.opened_at DESC
  LIMIT 1000;
$$;
REVOKE EXECUTE ON FUNCTION public.form_refs() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.form_refs() TO authenticated;

-- ───────── 20261006000004_form_approver_by_form.sql ─────────
-- Asset Submission and Expense Tracking forms are approved by Anu (anu@triloautomation.com); all others by Hari.
CREATE OR REPLACE FUNCTION public.submit_form_request(p_form_id uuid, p_data jsonb, p_authorizer uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form     public.production_forms%ROWTYPE;
  v_approver uuid;
  v_email    text;
  v_ref      text;
  v_id       uuid;
  v_name     text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO v_form FROM public.production_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;

  v_email := CASE WHEN v_form.title ~* '(asset|expense)' THEN 'anu@triloautomation.com'
                  ELSE 'hari@triloautomation.com' END;
  SELECT id INTO v_approver FROM public.profiles WHERE lower(email) = v_email LIMIT 1;
  IF v_approver IS NULL THEN RAISE EXCEPTION 'Approver (%) not found', v_email; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_authorizer) THEN
    RAISE EXCEPTION 'Pick who authorizes this form';
  END IF;

  IF v_form.ref_number_enabled THEN
    UPDATE public.production_forms SET current_number = current_number + 1, updated_at = now()
     WHERE id = p_form_id RETURNING ref_prefix || lpad(current_number::text, ref_padding, '0') INTO v_ref;
    INSERT INTO public.production_form_opens (form_id, opened_by, reference_value)
    VALUES (p_form_id, auth.uid(), v_ref);
  END IF;

  INSERT INTO public.form_requests (form_id, form_title, reference_value, data, requested_by, approver_id, authorizer_id)
  VALUES (p_form_id, v_form.title, v_ref, coalesce(p_data, '{}'::jsonb), auth.uid(), v_approver, p_authorizer)
  RETURNING id INTO v_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._form_notify(v_approver, 'Form waiting for your approval',
    coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  RETURN v_id;
END;
$$;

-- Requests already submitted for these two forms and still waiting for Hari move to Anu
UPDATE public.form_requests fr
   SET approver_id = (SELECT id FROM public.profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1)
 WHERE fr.status = 'pending_approval'
   AND fr.form_title ~* '(asset|expense)'
   AND EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = 'anu@triloautomation.com');

-- ───────── 20261006000005_form_approver_quality_check.sql ─────────
-- Approvers: Asset Submission / Expense Tracking → Anu, Quality Check Drawing → Harish Kanna MK, others → Hari
CREATE OR REPLACE FUNCTION public.submit_form_request(p_form_id uuid, p_data jsonb, p_authorizer uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form     public.production_forms%ROWTYPE;
  v_approver uuid;
  v_email    text;
  v_ref      text;
  v_id       uuid;
  v_name     text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO v_form FROM public.production_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;

  v_email := CASE
               WHEN v_form.title ~* '(asset|expense)' THEN 'anu@triloautomation.com'
               WHEN v_form.title ~* 'quality\s*check' THEN 'harishkanna@triloautomation.com'
               ELSE 'hari@triloautomation.com'
             END;
  SELECT id INTO v_approver FROM public.profiles WHERE lower(email) = v_email LIMIT 1;
  IF v_approver IS NULL THEN RAISE EXCEPTION 'Approver (%) not found', v_email; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_authorizer) THEN
    RAISE EXCEPTION 'Pick who authorizes this form';
  END IF;

  IF v_form.ref_number_enabled THEN
    UPDATE public.production_forms SET current_number = current_number + 1, updated_at = now()
     WHERE id = p_form_id RETURNING ref_prefix || lpad(current_number::text, ref_padding, '0') INTO v_ref;
    INSERT INTO public.production_form_opens (form_id, opened_by, reference_value)
    VALUES (p_form_id, auth.uid(), v_ref);
  END IF;

  INSERT INTO public.form_requests (form_id, form_title, reference_value, data, requested_by, approver_id, authorizer_id)
  VALUES (p_form_id, v_form.title, v_ref, coalesce(p_data, '{}'::jsonb), auth.uid(), v_approver, p_authorizer)
  RETURNING id INTO v_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._form_notify(v_approver, 'Form waiting for your approval',
    coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  RETURN v_id;
END;
$$;

-- Quality Check requests still waiting for approval move to Harish
UPDATE public.form_requests
   SET approver_id = (SELECT id FROM public.profiles WHERE lower(email) = 'harishkanna@triloautomation.com' LIMIT 1)
 WHERE status = 'pending_approval'
   AND form_title ~* 'quality\s*check'
   AND EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = 'harishkanna@triloautomation.com');

-- ───────── 20261006000006_form_vendor_no_approval.sql ─────────
-- Vendor Registration Form: no "Approved by" step — goes straight to the authorizer
-- (Saravanan / Jaisoorya). approver_id becomes optional.
ALTER TABLE public.form_requests ALTER COLUMN approver_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.submit_form_request(p_form_id uuid, p_data jsonb, p_authorizer uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form     public.production_forms%ROWTYPE;
  v_approver uuid;
  v_email    text;
  v_ref      text;
  v_id       uuid;
  v_name     text;
  v_direct   boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO v_form FROM public.production_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;

  v_direct := v_form.title ~* 'vendor\s*registration';
  IF NOT v_direct THEN
    v_email := CASE
                 WHEN v_form.title ~* '(asset|expense)' THEN 'anu@triloautomation.com'
                 WHEN v_form.title ~* 'quality\s*check' THEN 'harishkanna@triloautomation.com'
                 ELSE 'hari@triloautomation.com'
               END;
    SELECT id INTO v_approver FROM public.profiles WHERE lower(email) = v_email LIMIT 1;
    IF v_approver IS NULL THEN RAISE EXCEPTION 'Approver (%) not found', v_email; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_authorizer) THEN
    RAISE EXCEPTION 'Pick who authorizes this form';
  END IF;

  IF v_form.ref_number_enabled THEN
    UPDATE public.production_forms SET current_number = current_number + 1, updated_at = now()
     WHERE id = p_form_id RETURNING ref_prefix || lpad(current_number::text, ref_padding, '0') INTO v_ref;
    INSERT INTO public.production_form_opens (form_id, opened_by, reference_value)
    VALUES (p_form_id, auth.uid(), v_ref);
  END IF;

  INSERT INTO public.form_requests (form_id, form_title, reference_value, data, requested_by, approver_id, authorizer_id, status)
  VALUES (p_form_id, v_form.title, v_ref, coalesce(p_data, '{}'::jsonb), auth.uid(), v_approver, p_authorizer,
          CASE WHEN v_direct THEN 'pending_authorization' ELSE 'pending_approval' END)
  RETURNING id INTO v_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  IF v_direct THEN
    PERFORM public._form_notify(p_authorizer, 'Form waiting for your authorization',
      coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  ELSE
    PERFORM public._form_notify(v_approver, 'Form waiting for your approval',
      coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_form_request(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      public.form_requests%ROWTYPE;
  v_me   text;
  v_lbl  text;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_lbl := r.form_title || coalesce(' (' || r.reference_value || ')', '');
  SELECT full_name INTO v_me FROM public.profiles WHERE id = auth.uid();

  IF r.status = 'pending_approval' AND r.approver_id = auth.uid() THEN
    IF p_approve THEN
      UPDATE public.form_requests SET status = 'pending_authorization', approved_at = now(), updated_at = now() WHERE id = p_id;
      PERFORM public._form_notify(r.authorizer_id, 'Form waiting for your authorization',
        v_lbl || ' — approved by ' || coalesce(v_me, 'approver'), p_id);
      PERFORM public._form_notify(r.requested_by, 'Form approved by ' || coalesce(v_me, 'approver'),
        v_lbl || ' — now waiting for authorization', p_id);
    END IF;
  ELSIF r.status = 'pending_authorization' AND r.authorizer_id = auth.uid() THEN
    IF p_approve THEN
      UPDATE public.form_requests SET status = 'authorized', authorized_at = now(), updated_at = now() WHERE id = p_id;
      PERFORM public._form_notify(r.requested_by, 'Form authorized ✓', v_lbl || ' — authorized by ' || coalesce(v_me, 'authorizer'), p_id);
      IF r.approver_id IS NOT NULL THEN
        PERFORM public._form_notify(r.approver_id, 'Form authorized ✓', v_lbl || ' — authorized by ' || coalesce(v_me, 'authorizer'), p_id);
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'This request is not waiting for your decision';
  END IF;

  IF NOT p_approve THEN
    IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Please give a reason for rejecting'; END IF;
    UPDATE public.form_requests
       SET status = 'rejected', rejected_by = auth.uid(), rejected_at = now(), reject_reason = trim(p_reason), updated_at = now()
     WHERE id = p_id;
    PERFORM public._form_notify(r.requested_by, 'Form rejected', v_lbl || ' — ' || coalesce(v_me, '') || ': ' || trim(p_reason), p_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.resubmit_form_request(p_id uuid, p_data jsonb, p_authorizer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      public.form_requests%ROWTYPE;
  v_name text;
  v_auth uuid;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.requested_by <> auth.uid() THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'rejected' THEN RAISE EXCEPTION 'Only rejected requests can be resubmitted'; END IF;
  v_auth := coalesce(p_authorizer, r.authorizer_id);
  UPDATE public.form_requests
     SET data = coalesce(p_data, data), authorizer_id = v_auth,
         status = CASE WHEN r.approver_id IS NULL THEN 'pending_authorization' ELSE 'pending_approval' END,
         approved_at = NULL, authorized_at = NULL,
         rejected_by = NULL, rejected_at = NULL, reject_reason = NULL,
         submitted_at = now(), updated_at = now()
   WHERE id = p_id;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  IF r.approver_id IS NULL THEN
    PERFORM public._form_notify(v_auth, 'Form resubmitted for authorization',
      coalesce(v_name, 'Someone') || ' resubmitted ' || r.form_title || coalesce(' (' || r.reference_value || ')', ''), p_id);
  ELSE
    PERFORM public._form_notify(r.approver_id, 'Form resubmitted for approval',
      coalesce(v_name, 'Someone') || ' resubmitted ' || r.form_title || coalesce(' (' || r.reference_value || ')', ''), p_id);
  END IF;
END;
$$;

-- ───────── 20261007000001_form_approver_choice.sql ─────────
-- Quality Check Drawing: the requester picks the approver — Harish Kanna MK or Saravanan.
-- (Adds an optional p_approver to submit / resubmit.)
DROP FUNCTION IF EXISTS public.submit_form_request(uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.resubmit_form_request(uuid, jsonb, uuid);

-- may p_user approve this form when picked from the dropdown?
CREATE OR REPLACE FUNCTION public._form_approver_allowed(p_title text, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_title ~* 'quality\s*check' THEN EXISTS (
      SELECT 1 FROM public.profiles WHERE id = p_user
        AND (lower(email) = 'harishkanna@triloautomation.com' OR full_name ILIKE 'saravanan%'))
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.submit_form_request(p_form_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form     public.production_forms%ROWTYPE;
  v_approver uuid;
  v_email    text;
  v_ref      text;
  v_id       uuid;
  v_name     text;
  v_direct   boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO v_form FROM public.production_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;

  v_direct := v_form.title ~* 'vendor\s*registration';
  IF NOT v_direct THEN
    IF p_approver IS NOT NULL THEN
      IF NOT public._form_approver_allowed(v_form.title, p_approver) THEN
        RAISE EXCEPTION 'That person cannot approve this form';
      END IF;
      v_approver := p_approver;
    ELSE
      v_email := CASE
                   WHEN v_form.title ~* '(asset|expense)' THEN 'anu@triloautomation.com'
                   WHEN v_form.title ~* 'quality\s*check' THEN 'harishkanna@triloautomation.com'
                   ELSE 'hari@triloautomation.com'
                 END;
      SELECT id INTO v_approver FROM public.profiles WHERE lower(email) = v_email LIMIT 1;
      IF v_approver IS NULL THEN RAISE EXCEPTION 'Approver (%) not found', v_email; END IF;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_authorizer) THEN
    RAISE EXCEPTION 'Pick who authorizes this form';
  END IF;

  IF v_form.ref_number_enabled THEN
    UPDATE public.production_forms SET current_number = current_number + 1, updated_at = now()
     WHERE id = p_form_id RETURNING ref_prefix || lpad(current_number::text, ref_padding, '0') INTO v_ref;
    INSERT INTO public.production_form_opens (form_id, opened_by, reference_value)
    VALUES (p_form_id, auth.uid(), v_ref);
  END IF;

  INSERT INTO public.form_requests (form_id, form_title, reference_value, data, requested_by, approver_id, authorizer_id, status)
  VALUES (p_form_id, v_form.title, v_ref, coalesce(p_data, '{}'::jsonb), auth.uid(), v_approver, p_authorizer,
          CASE WHEN v_direct THEN 'pending_authorization' ELSE 'pending_approval' END)
  RETURNING id INTO v_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  IF v_direct THEN
    PERFORM public._form_notify(p_authorizer, 'Form waiting for your authorization',
      coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  ELSE
    PERFORM public._form_notify(v_approver, 'Form waiting for your approval',
      coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resubmit_form_request(p_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       public.form_requests%ROWTYPE;
  v_name  text;
  v_auth  uuid;
  v_appr  uuid;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.requested_by <> auth.uid() THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'rejected' THEN RAISE EXCEPTION 'Only rejected requests can be resubmitted'; END IF;
  v_auth := coalesce(p_authorizer, r.authorizer_id);
  v_appr := r.approver_id;
  IF p_approver IS NOT NULL AND r.approver_id IS NOT NULL AND p_approver <> r.approver_id THEN
    IF NOT public._form_approver_allowed(r.form_title, p_approver) THEN
      RAISE EXCEPTION 'That person cannot approve this form';
    END IF;
    v_appr := p_approver;
  END IF;
  UPDATE public.form_requests
     SET data = coalesce(p_data, data), authorizer_id = v_auth, approver_id = v_appr,
         status = CASE WHEN v_appr IS NULL THEN 'pending_authorization' ELSE 'pending_approval' END,
         approved_at = NULL, authorized_at = NULL,
         rejected_by = NULL, rejected_at = NULL, reject_reason = NULL,
         submitted_at = now(), updated_at = now()
   WHERE id = p_id;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  IF v_appr IS NULL THEN
    PERFORM public._form_notify(v_auth, 'Form resubmitted for authorization',
      coalesce(v_name, 'Someone') || ' resubmitted ' || r.form_title || coalesce(' (' || r.reference_value || ')', ''), p_id);
  ELSE
    PERFORM public._form_notify(v_appr, 'Form resubmitted for approval',
      coalesce(v_name, 'Someone') || ' resubmitted ' || r.form_title || coalesce(' (' || r.reference_value || ')', ''), p_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._form_approver_allowed(text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.submit_form_request(uuid, jsonb, uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.resubmit_form_request(uuid, jsonb, uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.submit_form_request(uuid, jsonb, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_form_request(uuid, jsonb, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────── 20261007000002_design_validation_harish.sql ─────────
-- Design Validation Form is approved by Harish Kanna MK
CREATE OR REPLACE FUNCTION public.submit_form_request(p_form_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form     public.production_forms%ROWTYPE;
  v_approver uuid;
  v_email    text;
  v_ref      text;
  v_id       uuid;
  v_name     text;
  v_direct   boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO v_form FROM public.production_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;

  v_direct := v_form.title ~* 'vendor\s*registration';
  IF NOT v_direct THEN
    IF p_approver IS NOT NULL THEN
      IF NOT public._form_approver_allowed(v_form.title, p_approver) THEN
        RAISE EXCEPTION 'That person cannot approve this form';
      END IF;
      v_approver := p_approver;
    ELSE
      v_email := CASE
                   WHEN v_form.title ~* '(asset|expense)' THEN 'anu@triloautomation.com'
                   WHEN v_form.title ~* '(quality\s*check|design\s*validation)' THEN 'harishkanna@triloautomation.com'
                   ELSE 'hari@triloautomation.com'
                 END;
      SELECT id INTO v_approver FROM public.profiles WHERE lower(email) = v_email LIMIT 1;
      IF v_approver IS NULL THEN RAISE EXCEPTION 'Approver (%) not found', v_email; END IF;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_authorizer) THEN
    RAISE EXCEPTION 'Pick who authorizes this form';
  END IF;

  IF v_form.ref_number_enabled THEN
    UPDATE public.production_forms SET current_number = current_number + 1, updated_at = now()
     WHERE id = p_form_id RETURNING ref_prefix || lpad(current_number::text, ref_padding, '0') INTO v_ref;
    INSERT INTO public.production_form_opens (form_id, opened_by, reference_value)
    VALUES (p_form_id, auth.uid(), v_ref);
  END IF;

  INSERT INTO public.form_requests (form_id, form_title, reference_value, data, requested_by, approver_id, authorizer_id, status)
  VALUES (p_form_id, v_form.title, v_ref, coalesce(p_data, '{}'::jsonb), auth.uid(), v_approver, p_authorizer,
          CASE WHEN v_direct THEN 'pending_authorization' ELSE 'pending_approval' END)
  RETURNING id INTO v_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  IF v_direct THEN
    PERFORM public._form_notify(p_authorizer, 'Form waiting for your authorization',
      coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  ELSE
    PERFORM public._form_notify(v_approver, 'Form waiting for your approval',
      coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  END IF;
  RETURN v_id;
END;
$$;

-- Design Validation numbers: 001 is already used on paper, so the next one is TRILO/DVF/002
UPDATE public.production_forms SET current_number = 1, ref_prefix = 'TRILO/DVF/', ref_padding = 3, updated_at = now()
 WHERE title ~* 'design\s*validation' AND current_number < 1;

-- ───────── 20261007000003_design_validation_approver_choice.sql ─────────
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

-- ───────── 20261007000004_payment_verification.sql ─────────
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

-- ───────── 20261007000005_overtime.sql ─────────
-- ═══════════════════════════════════════════════════════════════════════
--  Overtime: admins add entries (many people at once) → a manager/admin
--  verifies → anu@triloautomation.com is notified.
--  Visible only to admins, managers and anu@triloautomation.com.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Allow an 'overtime' notification type (keeps every type already in use)
DO $$
DECLARE v_types text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(t), ',') INTO v_types
  FROM (SELECT type AS t FROM public.notifications WHERE type IS NOT NULL
        UNION SELECT unnest(ARRAY['task','leave','system','payment','form','overtime'])) x;
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (' || v_types || '))';
END $$;

-- 2. Who may use the page
CREATE OR REPLACE FUNCTION public.can_see_overtime(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid
      AND (role IN ('admin','super_admin','manager') OR lower(email) = 'anu@triloautomation.com')
  )
$$;

-- 3. Entries
CREATE TABLE IF NOT EXISTS public.overtime_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date      date NOT NULL DEFAULT current_date,
  employee_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  half           text NOT NULL CHECK (half IN ('first','second')),
  duration_hours numeric(4,2) NOT NULL CHECK (duration_hours > 0 AND duration_hours <= 24),
  note           text,
  created_by     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  verified_by    uuid REFERENCES public.profiles(id),
  verified_at    timestamptz
);
CREATE INDEX IF NOT EXISTS overtime_entries_date_idx ON public.overtime_entries (work_date DESC);
ALTER TABLE public.overtime_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ot_read ON public.overtime_entries;
CREATE POLICY ot_read ON public.overtime_entries FOR SELECT TO authenticated
  USING (public.can_see_overtime(auth.uid()));

DROP POLICY IF EXISTS ot_admin_insert ON public.overtime_entries;
CREATE POLICY ot_admin_insert ON public.overtime_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) AND created_by = auth.uid() AND verified_at IS NULL AND verified_by IS NULL);

DROP POLICY IF EXISTS ot_admin_update_unverified ON public.overtime_entries;
CREATE POLICY ot_admin_update_unverified ON public.overtime_entries FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) AND verified_at IS NULL)
  WITH CHECK (public.is_admin(auth.uid()) AND verified_at IS NULL);

DROP POLICY IF EXISTS ot_admin_delete ON public.overtime_entries;
CREATE POLICY ot_admin_delete ON public.overtime_entries FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- 4. Verify (managers + admins) → one notification to Anu listing the entries
CREATE OR REPLACE FUNCTION public.verify_overtime(p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    text;
  v_anu   uuid;
  v_lines text;
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'Only managers and admins can verify overtime';
  END IF;

  WITH upd AS (
    UPDATE overtime_entries SET verified_by = auth.uid(), verified_at = now()
     WHERE id = ANY(p_ids) AND verified_at IS NULL
    RETURNING employee_id, work_date, half, duration_hours
  )
  SELECT count(*),
         string_agg(coalesce(p.full_name, '?') || ' — ' || to_char(u.work_date, 'DD Mon') || ', ' ||
                    CASE u.half WHEN 'first' THEN 'First half' ELSE 'Second half' END || ', ' ||
                    trim(trailing '.' FROM trim(trailing '0' FROM u.duration_hours::text)) || ' h',
                    E'\n' ORDER BY u.work_date, p.full_name)
    INTO v_count, v_lines
    FROM upd u LEFT JOIN profiles p ON p.id = u.employee_id;

  IF v_count = 0 THEN RETURN 0; END IF;

  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();
  SELECT id INTO v_anu FROM profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
  IF v_anu IS NOT NULL AND v_anu <> auth.uid() THEN
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_anu, 'Overtime verified (' || v_count || ' ' || CASE WHEN v_count = 1 THEN 'entry' ELSE 'entries' END || ')',
            'Verified by ' || coalesce(v_me, 'a manager') || E':\n' || v_lines, 'overtime');
  END IF;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_overtime(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_overtime(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_see_overtime(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_see_overtime(uuid) TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.overtime_entries;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

-- ───────── 20261007000006_overtime_members.sql ─────────
-- People dedicated to overtime — admins keep this list; only they can be picked for an OT entry
CREATE TABLE IF NOT EXISTS public.overtime_members (
  employee_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by    uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  added_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.overtime_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS otm_read ON public.overtime_members;
CREATE POLICY otm_read ON public.overtime_members FOR SELECT TO authenticated
  USING (public.can_see_overtime(auth.uid()));
DROP POLICY IF EXISTS otm_admin_insert ON public.overtime_members;
CREATE POLICY otm_admin_insert ON public.overtime_members FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS otm_admin_delete ON public.overtime_members;
CREATE POLICY otm_admin_delete ON public.overtime_members FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- OT entries can only be added for people on the list
DROP POLICY IF EXISTS ot_admin_insert ON public.overtime_entries;
CREATE POLICY ot_admin_insert ON public.overtime_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid()) AND created_by = auth.uid() AND verified_at IS NULL AND verified_by IS NULL
    AND EXISTS (SELECT 1 FROM public.overtime_members m WHERE m.employee_id = overtime_entries.employee_id)
  );

NOTIFY pgrst, 'reload schema';

-- ───────── 20261007000007_overtime_manager_entry.sql ─────────
-- Managers (and admins) enter overtime for the admin's OT members.
-- Each entry is sent to anu@triloautomation.com straight away.
DROP POLICY IF EXISTS ot_admin_insert ON public.overtime_entries;   -- entries now go through add_overtime()

CREATE OR REPLACE FUNCTION public.add_overtime(
  p_date date, p_employee_ids uuid[], p_half text, p_hours numeric, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    text;
  v_anu   uuid;
  v_lines text;
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'Only managers and admins can enter overtime';
  END IF;
  IF p_half NOT IN ('first','second') THEN RAISE EXCEPTION 'Choose First half or Second half'; END IF;
  IF p_hours IS NULL OR p_hours <= 0 OR p_hours > 24 THEN RAISE EXCEPTION 'Enter the OT duration in hours'; END IF;
  IF coalesce(array_length(p_employee_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one name'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_employee_ids) e(id)
             WHERE NOT EXISTS (SELECT 1 FROM overtime_members m WHERE m.employee_id = e.id)) THEN
    RAISE EXCEPTION 'Only people on the OT members list can be selected';
  END IF;

  WITH ins AS (
    INSERT INTO overtime_entries (work_date, employee_id, half, duration_hours, note, created_by, verified_by, verified_at)
    SELECT coalesce(p_date, current_date), e.id, p_half, p_hours, nullif(trim(p_note), ''), auth.uid(), auth.uid(), now()
      FROM (SELECT DISTINCT unnest(p_employee_ids) AS id) e
    RETURNING employee_id
  )
  SELECT count(*), string_agg(coalesce(p.full_name, '?'), ', ' ORDER BY p.full_name)
    INTO v_count, v_lines
    FROM ins i LEFT JOIN profiles p ON p.id = i.employee_id;

  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();
  SELECT id INTO v_anu FROM profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
  IF v_anu IS NOT NULL AND v_anu <> auth.uid() THEN
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_anu,
      'Overtime entered — ' || to_char(coalesce(p_date, current_date), 'DD Mon YYYY'),
      coalesce(v_me, 'A manager') || ' entered overtime (' ||
        CASE p_half WHEN 'first' THEN 'First half' ELSE 'Second half' END || ', ' ||
        trim(trailing '.' FROM trim(trailing '0' FROM p_hours::text)) || ' h' ||
        coalesce(', ' || nullif(trim(p_note), ''), '') || ') for ' || v_count || ' ' ||
        CASE WHEN v_count = 1 THEN 'person' ELSE 'people' END || ': ' || v_lines,
      'overtime');
  END IF;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_overtime(date, uuid[], text, numeric, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.add_overtime(date, uuid[], text, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────── 20261007000008_payment_manager_direct.sql ─────────
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

-- ───────── 20261008000001_overtime_times.sql ─────────
-- Overtime: start / end time per person; hours are worked out from them
ALTER TABLE public.overtime_entries
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time   time;

CREATE OR REPLACE FUNCTION public.add_overtime_entries(p_date date, p_entries jsonb, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e       jsonb;
  v_emp   uuid;
  v_half  text;
  v_start time;
  v_end   time;
  v_mins  integer;
  v_me    text;
  v_anu   uuid;
  v_lines text := '';
  v_count integer := 0;
  v_name  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'Only managers and admins can enter overtime';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'Select at least one name';
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_emp   := (e->>'employee_id')::uuid;
    v_half  := e->>'half';
    v_start := (e->>'start_time')::time;
    v_end   := (e->>'end_time')::time;
    IF NOT EXISTS (SELECT 1 FROM overtime_members m WHERE m.employee_id = v_emp) THEN
      RAISE EXCEPTION 'Only people on the OT members list can be selected';
    END IF;
    IF v_half NOT IN ('first','second') THEN RAISE EXCEPTION 'Choose First half or Second half'; END IF;
    IF v_start IS NULL OR v_end IS NULL THEN RAISE EXCEPTION 'Enter the start and end time'; END IF;
    v_mins := (extract(epoch FROM (v_end - v_start)) / 60)::int;
    IF v_mins <= 0 THEN v_mins := v_mins + 1440; END IF;          -- ran past midnight
    IF v_mins > 960 THEN RAISE EXCEPTION 'Overtime of more than 16 hours — please check the times'; END IF;

    INSERT INTO overtime_entries (work_date, employee_id, half, start_time, end_time, duration_hours, note,
                                  created_by, verified_by, verified_at)
    VALUES (coalesce(p_date, current_date), v_emp, v_half, v_start, v_end, round(v_mins / 60.0, 2),
            nullif(trim(p_note), ''), auth.uid(), auth.uid(), now());

    SELECT full_name INTO v_name FROM profiles WHERE id = v_emp;
    v_lines := v_lines || E'\n• ' || coalesce(v_name, '?') || ' — ' ||
               CASE v_half WHEN 'first' THEN 'First half' ELSE 'Second half' END || ', ' ||
               to_char(v_start, 'HH12:MI AM') || ' to ' || to_char(v_end, 'HH12:MI AM') || ' (' ||
               (v_mins / 60) || 'h ' || lpad((v_mins % 60)::text, 2, '0') || 'm)';
    v_count := v_count + 1;
  END LOOP;

  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();
  SELECT id INTO v_anu FROM profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
  IF v_anu IS NOT NULL AND v_anu <> auth.uid() THEN
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_anu,
      'Overtime entered — ' || to_char(coalesce(p_date, current_date), 'DD Mon YYYY'),
      coalesce(v_me, 'A manager') || ' entered overtime for ' || v_count || ' ' ||
        CASE WHEN v_count = 1 THEN 'person' ELSE 'people' END ||
        coalesce(' (' || nullif(trim(p_note), '') || ')', '') || ':' || v_lines,
      'overtime');
  END IF;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_overtime_entries(date, jsonb, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.add_overtime_entries(date, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ───────── 20261008000002_form_attachments.sql ─────────
-- Documents attached to form requests (Material IN / OUT) — private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('form-attachments', 'form-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- upload only into your own folder (<user id>/...)
DROP POLICY IF EXISTS form_attachments_insert ON storage.objects;
CREATE POLICY form_attachments_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'form-attachments' AND split_part(name, '/', 1) = auth.uid()::text);

-- read: the uploader, or anyone who can see the request it is attached to
DROP POLICY IF EXISTS form_attachments_read ON storage.objects;
CREATE POLICY form_attachments_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'form-attachments'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.form_requests fr
        WHERE fr.data->'attachments' @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
          AND (fr.requested_by = auth.uid() OR fr.approver_id = auth.uid() OR fr.authorizer_id = auth.uid())
      )
    )
  );

-- remove: the uploader (their own files) or admins
DROP POLICY IF EXISTS form_attachments_delete ON storage.objects;
CREATE POLICY form_attachments_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'form-attachments' AND (split_part(name, '/', 1) = auth.uid()::text OR public.is_admin(auth.uid())));

-- ───────── 20261008000003_payment_paid.sql ─────────
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

-- ───────── 20261009000001_form_edit_anytime.sql ─────────
-- The requester can edit a form any time before it is authorized (not only after a rejection).
-- Editing restarts the sign-off: back to the approver (or the authorizer for forms without an approver).
CREATE OR REPLACE FUNCTION public.resubmit_form_request(p_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       public.form_requests%ROWTYPE;
  v_name  text;
  v_auth  uuid;
  v_appr  uuid;
  v_verb  text;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.requested_by <> auth.uid() THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status = 'authorized' THEN RAISE EXCEPTION 'This form is already authorized and can no longer be edited'; END IF;
  v_verb := CASE WHEN r.status = 'rejected' THEN 'resubmitted' ELSE 'updated' END;

  v_auth := coalesce(p_authorizer, r.authorizer_id);
  v_appr := r.approver_id;
  IF p_approver IS NOT NULL AND r.approver_id IS NOT NULL AND p_approver <> r.approver_id THEN
    IF NOT public._form_approver_allowed(r.form_title, p_approver) THEN
      RAISE EXCEPTION 'That person cannot approve this form';
    END IF;
    v_appr := p_approver;
  END IF;

  UPDATE public.form_requests
     SET data = coalesce(p_data, data), authorizer_id = v_auth, approver_id = v_appr,
         status = CASE WHEN v_appr IS NULL THEN 'pending_authorization' ELSE 'pending_approval' END,
         approved_at = NULL, authorized_at = NULL,
         rejected_by = NULL, rejected_at = NULL, reject_reason = NULL,
         submitted_at = now(), updated_at = now()
   WHERE id = p_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._form_notify(coalesce(v_appr, v_auth),
    'Form ' || v_verb || ' — please review',
    coalesce(v_name, 'Someone') || ' ' || v_verb || ' ' || r.form_title || coalesce(' (' || r.reference_value || ')', ''), p_id);
  -- the authorizer was already waiting on it → let them know it went back for approval
  IF r.status = 'pending_authorization' AND v_appr IS NOT NULL AND v_auth IS DISTINCT FROM v_appr THEN
    PERFORM public._form_notify(v_auth, 'Form edited by the requester',
      r.form_title || coalesce(' (' || r.reference_value || ')', '') || ' was edited and has gone back for approval.', p_id);
  END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';

-- ───────── 20261009000002_payment_receipt.sql ─────────
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

-- ───────── 20261009000003_form_revision.sql ─────────
-- Every edit by the requester bumps the revision (Rev 01, 02 …) and sends the form for approval again
ALTER TABLE public.form_requests ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.resubmit_form_request(p_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.form_requests%ROWTYPE; v_name text; v_auth uuid; v_appr uuid; v_rev integer; v_lbl text;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.requested_by <> auth.uid() THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status = 'authorized' THEN RAISE EXCEPTION 'This form is already authorized and can no longer be edited'; END IF;

  v_auth := coalesce(p_authorizer, r.authorizer_id);
  v_appr := r.approver_id;
  IF p_approver IS NOT NULL AND r.approver_id IS NOT NULL AND p_approver <> r.approver_id THEN
    IF NOT public._form_approver_allowed(r.form_title, p_approver) THEN
      RAISE EXCEPTION 'That person cannot approve this form';
    END IF;
    v_appr := p_approver;
  END IF;
  v_rev := coalesce(r.revision, 0) + 1;

  UPDATE public.form_requests
     SET data = coalesce(p_data, data), authorizer_id = v_auth, approver_id = v_appr, revision = v_rev,
         status = CASE WHEN v_appr IS NULL THEN 'pending_authorization' ELSE 'pending_approval' END,
         approved_at = NULL, authorized_at = NULL, rejected_by = NULL, rejected_at = NULL, reject_reason = NULL,
         submitted_at = now(), updated_at = now()
   WHERE id = p_id;

  v_lbl := r.form_title || coalesce(' (' || r.reference_value || ')', '') || ' — Rev ' || lpad(v_rev::text, 2, '0');
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._form_notify(coalesce(v_appr, v_auth),
    CASE WHEN v_appr IS NULL THEN 'Revised form waiting for your authorization' ELSE 'Revised form waiting for your approval' END,
    coalesce(v_name, 'Someone') || ' edited ' || v_lbl, p_id);
  -- anyone who had already signed is told it needs signing again
  IF v_auth IS DISTINCT FROM v_appr AND r.status IN ('pending_authorization','rejected') AND v_appr IS NOT NULL THEN
    PERFORM public._form_notify(v_auth, 'Form revised — will come back for authorization',
      v_lbl || ' was edited and has gone back for approval first.', p_id);
  END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
