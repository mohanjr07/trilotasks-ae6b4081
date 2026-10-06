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
