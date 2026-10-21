-- ─────────────────────────────────────────────────────────────────────────────
--  Production Plan — who can create and who can see.
--  • Only admins / managers can create a plan.
--  • Admins / managers see every plan.
--  • Everyone else sees a plan only when they are included in it: its owner,
--    or the owner / approver of one of its tasks. Then they see that plan, its
--    tasks, approvals, BOM and history. Plans they are not part of stay hidden.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._pp_can_view(p_project uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._pp_is_lead(p_user)
      OR EXISTS (SELECT 1 FROM public.pp_plans WHERE project_id = p_project AND (owner_id = p_user OR created_by = p_user))
      OR EXISTS (SELECT 1 FROM public.pp_tasks WHERE project_id = p_project AND (owner_id = p_user OR approver_id = p_user))
$$;
REVOKE EXECUTE ON FUNCTION public._pp_can_view(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public._pp_can_view(uuid, uuid), public._pp_is_lead(uuid) TO authenticated;

DROP POLICY IF EXISTS pp_plans_read ON public.pp_plans;
CREATE POLICY pp_plans_read ON public.pp_plans FOR SELECT TO authenticated
  USING (public._pp_can_view(project_id, auth.uid()));

DROP POLICY IF EXISTS pp_tasks_read ON public.pp_tasks;
CREATE POLICY pp_tasks_read ON public.pp_tasks FOR SELECT TO authenticated
  USING (public._pp_can_view(project_id, auth.uid()));

DROP POLICY IF EXISTS pp_approvals_read ON public.pp_approvals;
CREATE POLICY pp_approvals_read ON public.pp_approvals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pp_tasks t WHERE t.id = task_id AND public._pp_can_view(t.project_id, auth.uid())));

DROP POLICY IF EXISTS pp_history_read ON public.pp_history;
CREATE POLICY pp_history_read ON public.pp_history FOR SELECT TO authenticated
  USING (public._pp_is_lead(auth.uid())
         OR (entity = 'project' AND public._pp_can_view(entity_id, auth.uid()))
         OR (entity = 'task' AND EXISTS (SELECT 1 FROM public.pp_tasks t WHERE t.id = entity_id AND public._pp_can_view(t.project_id, auth.uid()))));

DO $$ BEGIN
  IF to_regclass('public.pp_bom_items') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS pp_bom_read ON public.pp_bom_items';
    EXECUTE 'CREATE POLICY pp_bom_read ON public.pp_bom_items FOR SELECT TO authenticated USING (public._pp_can_view(project_id, auth.uid()))';
  END IF;
END $$;

-- only admins / managers create plans; the plan owner (or an admin / manager) edits it
CREATE OR REPLACE FUNCTION public.pp_save_plan(p_project_id uuid, p_name text, p_fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := p_project_id; v_me uuid := auth.uid(); v_lead boolean; v_exists boolean; f jsonb := coalesce(p_fields, '{}'::jsonb);
        v_owner uuid; v_pname text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  v_lead := public._pp_is_lead(v_me);
  IF v_pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_pid) THEN RAISE EXCEPTION 'Project not found'; END IF;
  v_exists := v_pid IS NOT NULL AND EXISTS (SELECT 1 FROM public.pp_plans WHERE project_id = v_pid);

  IF NOT v_exists THEN
    IF NOT v_lead THEN RAISE EXCEPTION 'Only admins and managers can create a production plan'; END IF;
    IF v_pid IS NULL THEN
      IF nullif(trim(coalesce(p_name, '')), '') IS NULL THEN RAISE EXCEPTION 'Enter a project name'; END IF;
      SELECT id INTO v_pid FROM public.projects WHERE lower(trim(name)) = lower(trim(p_name)) LIMIT 1;
      IF v_pid IS NULL THEN
        INSERT INTO public.projects (name, created_by) VALUES (trim(p_name), v_me) RETURNING id INTO v_pid;
      ELSIF EXISTS (SELECT 1 FROM public.pp_plans WHERE project_id = v_pid) THEN
        RAISE EXCEPTION 'This project already has a plan';
      END IF;
    END IF;
    v_owner := coalesce(nullif(f->>'owner_id','')::uuid, v_me);
    INSERT INTO public.pp_plans (project_id, owner_id, created_by, title, phase, plan_type, description, est_start, est_finish)
    VALUES (v_pid, v_owner, v_me, nullif(f->>'title',''), nullif(f->>'phase',''), nullif(f->>'plan_type',''), nullif(f->>'description',''),
            nullif(f->>'est_start','')::date, nullif(f->>'est_finish','')::date);
    SELECT name INTO v_pname FROM public.projects WHERE id = v_pid;
    PERFORM public._pp_notify(v_owner, 'you own a plan', coalesce(v_pname, 'A project') || ' — you are the plan owner', NULL);
    RETURN v_pid;
  END IF;

  IF NOT public._pp_can_manage(v_pid, v_me) THEN RAISE EXCEPTION 'Only the plan owner or an admin/manager can change this plan'; END IF;
  SELECT owner_id INTO v_owner FROM public.pp_plans WHERE project_id = v_pid;
  UPDATE public.pp_plans SET
    title         = CASE WHEN f ? 'title'         THEN nullif(f->>'title','')         ELSE title END,
    phase         = CASE WHEN f ? 'phase'         THEN nullif(f->>'phase','')         ELSE phase END,
    plan_type     = CASE WHEN f ? 'plan_type'     THEN nullif(f->>'plan_type','')     ELSE plan_type END,
    description   = CASE WHEN f ? 'description'   THEN nullif(f->>'description','')   ELSE description END,
    est_start     = CASE WHEN f ? 'est_start'     THEN nullif(f->>'est_start','')::date     ELSE est_start END,
    est_finish    = CASE WHEN f ? 'est_finish'    THEN nullif(f->>'est_finish','')::date    ELSE est_finish END,
    actual_finish = CASE WHEN f ? 'actual_finish' THEN nullif(f->>'actual_finish','')::date ELSE actual_finish END,
    owner_id      = CASE WHEN v_lead AND nullif(f->>'owner_id','') IS NOT NULL THEN (f->>'owner_id')::uuid ELSE owner_id END,
    updated_at    = now()
  WHERE project_id = v_pid;
  IF v_lead AND nullif(f->>'owner_id','') IS NOT NULL AND (f->>'owner_id')::uuid IS DISTINCT FROM v_owner THEN
    SELECT name INTO v_pname FROM public.projects WHERE id = v_pid;
    PERFORM public._pp_notify((f->>'owner_id')::uuid, 'you own a plan', coalesce(v_pname, 'A project') || ' — you are now the plan owner', NULL);
  END IF;
  RETURN v_pid;
END;
$$;

-- the plan owner who is not an admin/manager is only the person it was given to, not its creator
CREATE OR REPLACE FUNCTION public._pp_can_manage(p_project uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._pp_is_lead(p_user) OR EXISTS (
    SELECT 1 FROM public.pp_plans WHERE project_id = p_project AND owner_id = p_user)
$$;

NOTIFY pgrst, 'reload schema';
