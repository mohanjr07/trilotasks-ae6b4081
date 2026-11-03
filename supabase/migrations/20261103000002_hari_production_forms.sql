-- ─────────────────────────────────────────────────────────────────────────────
--  Hari (hari@triloautomation.com) can see every production form, whether or
--  not he is its approver:
--    • every form raised by production@triloautomation.com, and
--    • every Production-type form raised by anyone (title has "Production",
--      or the form sits in the Production stage of the project timeline).
--  View only — approving / authorizing still follows the normal flow.
--  Run in the Trilo Attendance Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.projects WHERE name = 'Coldstar_PUNE - G+2 Spiral Chute') THEN RAISE EXCEPTION 'Wrong database — run this in the Trilo Attendance project'; END IF; END $$;

CREATE OR REPLACE FUNCTION public._hari_sees_form(p_form_id uuid, p_title text, p_requested_by uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND lower(email) = 'hari@triloautomation.com')
     AND (
       coalesce(p_title, '') ~* 'production'
       OR EXISTS (SELECT 1 FROM form_stage_map m WHERE m.form_id = p_form_id AND m.stage = 'production')
       OR EXISTS (SELECT 1 FROM profiles WHERE id = p_requested_by AND lower(email) = 'production@triloautomation.com')
     )
$$;
REVOKE EXECUTE ON FUNCTION public._hari_sees_form(uuid, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public._hari_sees_form(uuid, text, uuid) TO authenticated;

-- the form requests themselves
DROP POLICY IF EXISTS form_requests_read ON public.form_requests;
CREATE POLICY form_requests_read ON public.form_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid() OR approver_id = auth.uid() OR authorizer_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public._hari_sees_form(form_id, form_title, requested_by)
  );

-- documents attached to those forms
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
          AND (fr.requested_by = auth.uid() OR fr.approver_id = auth.uid() OR fr.authorizer_id = auth.uid()
               OR public._hari_sees_form(fr.form_id, fr.form_title, fr.requested_by))
      )
    )
  );

NOTIFY pgrst, 'reload schema';
