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
