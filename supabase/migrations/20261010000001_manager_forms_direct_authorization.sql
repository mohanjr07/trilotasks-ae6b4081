-- Forms raised by a MANAGER skip the "Approved by" step and go straight to the chosen authorizer.
-- (Vendor Registration still goes only to Anu.)

CREATE OR REPLACE FUNCTION public.submit_form_request(p_form_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form public.production_forms%ROWTYPE; v_approver uuid; v_email text; v_ref text; v_id uuid; v_name text;
  v_direct boolean; v_auth uuid; v_mgr boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO v_form FROM public.production_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;

  v_direct := v_form.title ~* 'vendor\s*registration';
  -- managers skip the "Approved by" step: straight to the chosen authorizer
  v_mgr := EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'manager');
  v_auth := p_authorizer;
  IF v_direct THEN
    SELECT id INTO v_auth FROM public.profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
    IF v_auth IS NULL THEN RAISE EXCEPTION 'Anu (anu@triloautomation.com) not found'; END IF;
  ELSIF v_mgr THEN
    IF v_auth IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth) THEN
      RAISE EXCEPTION 'Pick who authorizes this form';
    END IF;
  ELSE
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
    IF v_auth IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_auth) THEN
      RAISE EXCEPTION 'Pick who authorizes this form';
    END IF;
  END IF;

  IF v_form.ref_number_enabled THEN
    UPDATE public.production_forms SET current_number = current_number + 1, updated_at = now()
     WHERE id = p_form_id RETURNING ref_prefix || lpad(current_number::text, ref_padding, '0') INTO v_ref;
    INSERT INTO public.production_form_opens (form_id, opened_by, reference_value) VALUES (p_form_id, auth.uid(), v_ref);
  END IF;

  INSERT INTO public.form_requests (form_id, form_title, reference_value, data, requested_by, approver_id, authorizer_id, status)
  VALUES (p_form_id, v_form.title, v_ref, coalesce(p_data, '{}'::jsonb), auth.uid(), v_approver, v_auth,
          CASE WHEN v_direct OR v_mgr THEN 'pending_authorization' ELSE 'pending_approval' END)
  RETURNING id INTO v_id;

  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._form_notify(CASE WHEN v_direct OR v_mgr THEN v_auth ELSE v_approver END,
    CASE WHEN v_mgr AND NOT v_direct THEN 'Form waiting for your authorization' ELSE 'Form waiting for your approval' END,
    coalesce(v_name, 'Someone') || ' submitted ' || v_form.title || coalesce(' (' || v_ref || ')', ''), v_id);
  RETURN v_id;
END;
$$;

-- Resubmit / edit: Vendor Registration always goes back to Anu
CREATE OR REPLACE FUNCTION public.resubmit_form_request(p_id uuid, p_data jsonb, p_authorizer uuid, p_approver uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.form_requests%ROWTYPE; v_name text; v_auth uuid; v_appr uuid; v_rev integer; v_lbl text;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.requested_by <> auth.uid() THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status = 'authorized' THEN RAISE EXCEPTION 'This form is already authorized and can no longer be edited'; END IF;

  v_appr := r.approver_id;
  IF r.form_title ~* 'vendor\s*registration' THEN
    SELECT id INTO v_auth FROM public.profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
    v_auth := coalesce(v_auth, r.authorizer_id);
    v_appr := NULL;
  ELSIF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'manager') THEN
    v_auth := coalesce(p_authorizer, r.authorizer_id);
    v_appr := NULL;                        -- managers: straight to authorization
  ELSE
    v_auth := coalesce(p_authorizer, r.authorizer_id);
    IF p_approver IS NOT NULL AND r.approver_id IS NOT NULL AND p_approver <> r.approver_id THEN
      IF NOT public._form_approver_allowed(r.form_title, p_approver) THEN
        RAISE EXCEPTION 'That person cannot approve this form';
      END IF;
      v_appr := p_approver;
    END IF;
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
    CASE WHEN v_appr IS NULL AND r.form_title !~* 'vendor\s*registration' THEN 'Revised form waiting for your authorization'
         ELSE 'Revised form waiting for your approval' END,
    coalesce(v_name, 'Someone') || ' edited ' || v_lbl, p_id);
  IF v_auth IS DISTINCT FROM v_appr AND r.status IN ('pending_authorization','rejected') AND v_appr IS NOT NULL THEN
    PERFORM public._form_notify(v_auth, 'Form revised — will come back for authorization',
      v_lbl || ' was edited and has gone back for approval first.', p_id);
  END IF;
END;
$$;

-- Managers' forms already waiting for approval → move them to authorization now
WITH moved AS (
  UPDATE public.form_requests fr
     SET status = 'pending_authorization', approver_id = NULL, updated_at = now()
   WHERE fr.status = 'pending_approval'
     AND fr.form_title !~* 'vendor\s*registration'
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = fr.requested_by AND p.role = 'manager')
  RETURNING fr.id, fr.authorizer_id, fr.form_title, fr.reference_value
)
INSERT INTO public.notifications (user_id, title, body, type, reference_id)
SELECT authorizer_id, 'Form waiting for your authorization',
       form_title || coalesce(' (' || reference_value || ')', '') || ' — raised by a manager, no approval needed', 'form', id
  FROM moved WHERE authorizer_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
