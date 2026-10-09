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
