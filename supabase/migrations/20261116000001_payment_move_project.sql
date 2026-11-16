-- ─────────────────────────────────────────────────────────────────────────────
--  Expenses: admins can move a payment to another project (or to "No project")
--  from the Project expenses screen. Run in the Trilo Attendance Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.projects WHERE name = 'Coldstar_PUNE - G+2 Spiral Chute') THEN RAISE EXCEPTION 'Wrong database — run this in the Trilo Attendance project'; END IF; END $$;

CREATE OR REPLACE FUNCTION public.set_payment_project(p_id uuid, p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')) THEN
    RAISE EXCEPTION 'Only admins can move payments between projects';
  END IF;
  IF p_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;
  UPDATE payment_requests SET project_id = p_project WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_payment_project(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_payment_project(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
