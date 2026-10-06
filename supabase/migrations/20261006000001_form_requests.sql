-- ═══════════════════════════════════════════════════════════════════════
--  Digital forms with approval:
--    requester fills a form → Hari approves → chosen authorizer
--    (Saravanan / Jaisoorya) authorizes. Either can reject with a reason;
--    the requester can edit and resubmit.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Allow a 'form' notification type
--    (keeps any other types already in use)
DO $$
DECLARE v_types text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(t), ',') INTO v_types
  FROM (SELECT type AS t FROM public.notifications WHERE type IS NOT NULL
        UNION SELECT unnest(ARRAY['task','leave','system','payment','form'])) x;
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (' || v_types || '))';
END $$;

-- 2. Requests
CREATE TABLE IF NOT EXISTS public.form_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id          uuid NOT NULL REFERENCES public.production_forms(id) ON DELETE CASCADE,
  form_title       text NOT NULL,
  reference_value  text,
  data             jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by     uuid NOT NULL REFERENCES public.profiles(id),
  approver_id      uuid NOT NULL REFERENCES public.profiles(id),
  authorizer_id    uuid NOT NULL REFERENCES public.profiles(id),
  status           text NOT NULL DEFAULT 'pending_approval'
                   CHECK (status IN ('pending_approval','pending_authorization','authorized','rejected')),
  approved_at      timestamptz,
  authorized_at    timestamptz,
  rejected_by      uuid REFERENCES public.profiles(id),
  rejected_at      timestamptz,
  reject_reason    text,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS form_requests_requested_by_idx ON public.form_requests (requested_by);
CREATE INDEX IF NOT EXISTS form_requests_approver_idx     ON public.form_requests (approver_id, status);
CREATE INDEX IF NOT EXISTS form_requests_authorizer_idx   ON public.form_requests (authorizer_id, status);

ALTER TABLE public.form_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS form_requests_read ON public.form_requests;
CREATE POLICY form_requests_read ON public.form_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid() OR approver_id = auth.uid() OR authorizer_id = auth.uid()
    OR public.is_admin(auth.uid())
  );
-- No direct insert/update/delete: everything goes through the functions below.
GRANT SELECT ON public.form_requests TO authenticated;
GRANT ALL ON public.form_requests TO service_role;

-- helper: notify one user
CREATE OR REPLACE FUNCTION public._form_notify(p_user uuid, p_title text, p_body text, p_req uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, title, body, type, reference_id)
  VALUES (p_user, p_title, p_body, 'form', p_req);
$$;
REVOKE EXECUTE ON FUNCTION public._form_notify(uuid, text, text, uuid) FROM anon, authenticated, public;

-- 3. Submit a new request (assigns the form's running reference number)
CREATE OR REPLACE FUNCTION public.submit_form_request(p_form_id uuid, p_data jsonb, p_authorizer uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form     public.production_forms%ROWTYPE;
  v_approver uuid;
  v_ref      text;
  v_id       uuid;
  v_name     text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  SELECT * INTO v_form FROM public.production_forms WHERE id = p_form_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;

  SELECT id INTO v_approver FROM public.profiles
   WHERE lower(email) = 'hari@triloautomation.com' LIMIT 1;
  IF v_approver IS NULL THEN RAISE EXCEPTION 'Approver (Hari) not found'; END IF;
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

-- 4. Approve / reject (Hari first, then the authorizer)
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
      PERFORM public._form_notify(r.approver_id, 'Form authorized ✓', v_lbl || ' — authorized by ' || coalesce(v_me, 'authorizer'), p_id);
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

-- 5. Edit + resubmit a rejected request (keeps its reference number)
CREATE OR REPLACE FUNCTION public.resubmit_form_request(p_id uuid, p_data jsonb, p_authorizer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      public.form_requests%ROWTYPE;
  v_name text;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.requested_by <> auth.uid() THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'rejected' THEN RAISE EXCEPTION 'Only rejected requests can be resubmitted'; END IF;
  UPDATE public.form_requests
     SET data = coalesce(p_data, data), authorizer_id = coalesce(p_authorizer, authorizer_id),
         status = 'pending_approval', approved_at = NULL, authorized_at = NULL,
         rejected_by = NULL, rejected_at = NULL, reject_reason = NULL,
         submitted_at = now(), updated_at = now()
   WHERE id = p_id;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = auth.uid();
  PERFORM public._form_notify(r.approver_id, 'Form resubmitted for approval',
    coalesce(v_name, 'Someone') || ' resubmitted ' || r.form_title || coalesce(' (' || r.reference_value || ')', ''), p_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_form_request(uuid, jsonb, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.decide_form_request(uuid, boolean, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.resubmit_form_request(uuid, jsonb, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.submit_form_request(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_form_request(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_form_request(uuid, jsonb, uuid) TO authenticated;

-- 6. Live updates for the approvals page
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.form_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
