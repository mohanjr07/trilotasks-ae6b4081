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

CREATE FUNCTION public.submit_form_request(p_form_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
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

CREATE FUNCTION public.resubmit_form_request(p_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
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
