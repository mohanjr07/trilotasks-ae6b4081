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
