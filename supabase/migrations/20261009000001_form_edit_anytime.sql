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
