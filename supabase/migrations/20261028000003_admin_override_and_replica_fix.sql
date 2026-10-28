-- 1) Admins (admin / super_admin) can approve or authorize any waiting form without the
--    approver / authorizer (the skipped person is told). Payments: the app lets admins
--    approve before verification (their existing update right already allows it).
-- 2) Fix "cannot update table … because it does not have a replica identity and publishes
--    updates": tables in the live-updates publication without a primary key get REPLICA
--    IDENTITY FULL, so they can be updated and deleted again (e.g. project_members).
CREATE OR REPLACE FUNCTION public.decide_form_request(p_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      public.form_requests%ROWTYPE;
  v_me   text;
  v_lbl  text;
  v_admin boolean;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  v_lbl := r.form_title || coalesce(' (' || r.reference_value || ')', '');
  SELECT full_name INTO v_me FROM public.profiles WHERE id = auth.uid();
  -- admins can decide any waiting form, without waiting for the approver / authorizer
  v_admin := EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'));

  IF r.status = 'pending_approval' AND (r.approver_id = auth.uid() OR v_admin) THEN
    IF p_approve THEN
      UPDATE public.form_requests SET status = 'pending_authorization', approved_at = now(), updated_at = now() WHERE id = p_id;
      PERFORM public._form_notify(r.authorizer_id, 'Form waiting for your authorization',
        v_lbl || ' — approved by ' || coalesce(v_me, 'approver'), p_id);
      PERFORM public._form_notify(r.requested_by, 'Form approved by ' || coalesce(v_me, 'approver'),
        v_lbl || ' — now waiting for authorization', p_id);
      IF r.approver_id IS DISTINCT FROM auth.uid() AND r.approver_id IS NOT NULL THEN
        PERFORM public._form_notify(r.approver_id, 'Form approved by admin', v_lbl || ' — approved by ' || coalesce(v_me, 'an admin') || ' on your behalf', p_id);
      END IF;
    END IF;
  ELSIF r.status = 'pending_authorization' AND (r.authorizer_id = auth.uid() OR v_admin) THEN
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

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS tbl
      FROM pg_publication_tables pt
      JOIN pg_class c ON c.relname = pt.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = pt.schemaname
     WHERE pt.pubname = 'supabase_realtime'
       AND c.relreplident = 'd'
       AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary)
  LOOP
    EXECUTE format('ALTER TABLE %s REPLICA IDENTITY FULL', t.tbl);
    RAISE NOTICE 'Replica identity FULL: %', t.tbl;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
