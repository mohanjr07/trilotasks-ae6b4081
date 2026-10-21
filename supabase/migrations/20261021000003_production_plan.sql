-- ─────────────────────────────────────────────────────────────────────────────
--  Production Plan
--  • pp_plans     — plan details on top of an existing project (title, phase, type,
--                   maturity, owner, dates). Anyone can start a plan; the owner or
--                   an admin/manager edits it.
--  • pp_tasks     — tasks under a project. Admins/managers or the plan owner create
--                   and edit them; the task owner moves it Draft → To Do → In Work →
--                   In Approval; the chosen approver (manager/admin) completes it.
--  • pp_approvals — one row per "send for approval".
--  • pp_history   — every create / change / promote / demote, written by triggers.
--  Everyone signed in can read; all writes go through the functions below.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pp_plans (
  project_id    uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  title         text,
  phase         text,
  plan_type     text,
  maturity      text NOT NULL DEFAULT 'draft' CHECK (maturity IN ('draft','active','review','completed')),
  owner_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  description   text,
  est_start     date,
  est_finish    date,
  actual_finish date,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pp_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text,
  priority          text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  percent_complete  numeric NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
  maturity          text NOT NULL DEFAULT 'draft' CHECK (maturity IN ('draft','todo','in_work','in_approval','completed')),
  owner_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approver_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  est_start         date,
  est_finish        date,
  est_duration_days numeric,
  actual_start      date,
  actual_finish     date,
  deliverables      text,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pp_tasks_project_idx ON public.pp_tasks (project_id);
CREATE INDEX IF NOT EXISTS pp_tasks_owner_idx ON public.pp_tasks (owner_id);

CREATE TABLE IF NOT EXISTS public.pp_approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES public.pp_tasks(id) ON DELETE CASCADE,
  approver_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  instructions text,
  comment      text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS pp_approvals_task_idx ON public.pp_approvals (task_id);

CREATE TABLE IF NOT EXISTS public.pp_history (
  id          bigserial PRIMARY KEY,
  entity      text NOT NULL CHECK (entity IN ('task','project')),
  entity_id   uuid NOT NULL,
  user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action      text NOT NULL,
  state       text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS pp_history_entity_idx ON public.pp_history (entity, entity_id, created_at);

ALTER TABLE public.pp_plans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_history   ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pp_plans_read ON public.pp_plans;
DROP POLICY IF EXISTS pp_tasks_read ON public.pp_tasks;
DROP POLICY IF EXISTS pp_approvals_read ON public.pp_approvals;
DROP POLICY IF EXISTS pp_history_read ON public.pp_history;
CREATE POLICY pp_plans_read     ON public.pp_plans     FOR SELECT TO authenticated USING (true);
CREATE POLICY pp_tasks_read     ON public.pp_tasks     FOR SELECT TO authenticated USING (true);
CREATE POLICY pp_approvals_read ON public.pp_approvals FOR SELECT TO authenticated USING (true);
CREATE POLICY pp_history_read   ON public.pp_history   FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.pp_plans, public.pp_tasks, public.pp_approvals, public.pp_history FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pp_plans, public.pp_tasks, public.pp_approvals, public.pp_history FROM authenticated;
GRANT SELECT ON public.pp_plans, public.pp_tasks, public.pp_approvals, public.pp_history TO authenticated;

-- ── helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._pp_is_lead(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND role IN ('admin','super_admin','manager'))
$$;

CREATE OR REPLACE FUNCTION public._pp_can_manage(p_project uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._pp_is_lead(p_user) OR EXISTS (
    SELECT 1 FROM public.pp_plans WHERE project_id = p_project AND (owner_id = p_user OR created_by = p_user))
$$;

CREATE OR REPLACE FUNCTION public._pp_name(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT full_name FROM public.profiles WHERE id = p_user), '')
$$;

CREATE OR REPLACE FUNCTION public._pp_state_label(p_state text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_state WHEN 'draft' THEN 'Draft' WHEN 'todo' THEN 'To Do' WHEN 'in_work' THEN 'In Work'
    WHEN 'in_approval' THEN 'In Approval' WHEN 'completed' THEN 'Completed' WHEN 'active' THEN 'Active'
    WHEN 'review' THEN 'Review' ELSE coalesce(p_state, '') END
$$;

CREATE OR REPLACE FUNCTION public._pp_rank(p_state text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_state WHEN 'draft' THEN 0 WHEN 'todo' THEN 1 WHEN 'active' THEN 1 WHEN 'in_work' THEN 2
    WHEN 'review' THEN 2 WHEN 'in_approval' THEN 3 WHEN 'completed' THEN 4 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public._pp_notify(p_user uuid, p_title text, p_body text, p_ref uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL OR p_user = auth.uid() THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, title, body, type, reference_id)
  VALUES (p_user, 'Production plan: ' || p_title, p_body, 'system', p_ref);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._pp_notify(uuid, text, text, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public._pp_is_lead(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._pp_can_manage(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._pp_name(uuid) FROM anon, public;

-- ── history (trigger) ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._pp_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entity text := CASE WHEN TG_TABLE_NAME = 'pp_tasks' THEN 'task' ELSE 'project' END;
  v_id uuid; o jsonb; n jsonb; k text; v_old text; v_new text; v_label text;
BEGIN
  n := to_jsonb(NEW);
  v_id := CASE WHEN v_entity = 'task' THEN (n->>'id')::uuid ELSE (n->>'project_id')::uuid END;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.pp_history (entity, entity_id, user_id, action, state, description)
    VALUES (v_entity, v_id, auth.uid(), 'Create', public._pp_state_label(n->>'maturity'),
            CASE WHEN v_entity = 'task' THEN 'Task created: ' || (n->>'title') ELSE 'Plan created' END);
    RETURN NEW;
  END IF;
  o := to_jsonb(OLD);
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    CONTINUE WHEN k IN ('updated_at','created_at','id','project_id','created_by');
    CONTINUE WHEN (o->k) IS NOT DISTINCT FROM (n->k);
    v_old := o->>k; v_new := n->>k;
    IF k = 'maturity' THEN
      INSERT INTO public.pp_history (entity, entity_id, user_id, action, state, description)
      VALUES (v_entity, v_id, auth.uid(),
              CASE WHEN public._pp_rank(v_new) >= public._pp_rank(v_old) THEN 'Promote' ELSE 'Demote' END,
              public._pp_state_label(v_new),
              public._pp_state_label(v_old) || ' → ' || public._pp_state_label(v_new));
      CONTINUE;
    END IF;
    IF k IN ('owner_id','approver_id') THEN
      v_old := nullif(public._pp_name(v_old::uuid), ''); v_new := nullif(public._pp_name(v_new::uuid), '');
    END IF;
    v_label := CASE k
      WHEN 'title' THEN 'Title' WHEN 'description' THEN 'Description' WHEN 'priority' THEN 'Priority'
      WHEN 'percent_complete' THEN '% Complete' WHEN 'owner_id' THEN 'Owner' WHEN 'approver_id' THEN 'Approver'
      WHEN 'est_start' THEN 'Estimated Start' WHEN 'est_finish' THEN 'Estimated Finish'
      WHEN 'est_duration_days' THEN 'Estimated Duration (days)' WHEN 'actual_start' THEN 'Actual Start'
      WHEN 'actual_finish' THEN 'Actual Finish' WHEN 'deliverables' THEN 'Deliverables'
      WHEN 'phase' THEN 'Current Phase' WHEN 'plan_type' THEN 'Type' ELSE k END;
    INSERT INTO public.pp_history (entity, entity_id, user_id, action, state, description)
    VALUES (v_entity, v_id, auth.uid(), 'Modify', public._pp_state_label(n->>'maturity'),
            v_label || ': ' || coalesce(v_new, '—') || ' (was: ' || coalesce(v_old, '—') || ')');
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pp_tasks_log ON public.pp_tasks;
CREATE TRIGGER pp_tasks_log AFTER INSERT OR UPDATE ON public.pp_tasks FOR EACH ROW EXECUTE FUNCTION public._pp_log();
DROP TRIGGER IF EXISTS pp_plans_log ON public.pp_plans;
CREATE TRIGGER pp_plans_log AFTER INSERT OR UPDATE ON public.pp_plans FOR EACH ROW EXECUTE FUNCTION public._pp_log();

-- ── all projects for the pickers ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pp_projects()
RETURNS TABLE (id uuid, name text, color text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.color, p.created_at FROM public.projects p
   WHERE auth.uid() IS NOT NULL ORDER BY p.name
$$;

-- ── create / edit a plan ────────────────────────────────────────────────────
-- p_project_id NULL → p_name is used: an existing project with that name, or a new project.
CREATE OR REPLACE FUNCTION public.pp_save_plan(p_project_id uuid, p_name text, p_fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid := p_project_id; v_me uuid := auth.uid(); v_lead boolean; v_exists boolean; f jsonb := coalesce(p_fields, '{}'::jsonb);
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  v_lead := public._pp_is_lead(v_me);
  IF v_pid IS NULL THEN
    IF nullif(trim(coalesce(p_name, '')), '') IS NULL THEN RAISE EXCEPTION 'Enter a project name'; END IF;
    SELECT id INTO v_pid FROM public.projects WHERE lower(trim(name)) = lower(trim(p_name)) LIMIT 1;
    IF v_pid IS NULL THEN
      INSERT INTO public.projects (name, created_by) VALUES (trim(p_name), v_me) RETURNING id INTO v_pid;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_pid) THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  v_exists := EXISTS (SELECT 1 FROM public.pp_plans WHERE project_id = v_pid);
  IF v_exists AND NOT public._pp_can_manage(v_pid, v_me) THEN
    RAISE EXCEPTION 'Only the plan owner or an admin can change this plan';
  END IF;
  IF NOT v_exists THEN
    INSERT INTO public.pp_plans (project_id, owner_id, created_by, title, phase, plan_type, description, est_start, est_finish)
    VALUES (v_pid,
            CASE WHEN v_lead AND nullif(f->>'owner_id','') IS NOT NULL THEN (f->>'owner_id')::uuid ELSE v_me END,
            v_me, nullif(f->>'title',''), nullif(f->>'phase',''), nullif(f->>'plan_type',''), nullif(f->>'description',''),
            nullif(f->>'est_start','')::date, nullif(f->>'est_finish','')::date);
    RETURN v_pid;
  END IF;

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
  RETURN v_pid;
END;
$$;

CREATE OR REPLACE FUNCTION public.pp_move_plan(p_project_id uuid, p_to text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._pp_can_manage(p_project_id, auth.uid()) THEN RAISE EXCEPTION 'Only the plan owner or an admin can change this plan'; END IF;
  IF p_to NOT IN ('draft','active','review','completed') THEN RAISE EXCEPTION 'Unknown state'; END IF;
  UPDATE public.pp_plans SET maturity = p_to,
         actual_finish = CASE WHEN p_to = 'completed' THEN coalesce(actual_finish, current_date) ELSE actual_finish END,
         updated_at = now()
   WHERE project_id = p_project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
END;
$$;

-- ── create / edit a task ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pp_save_task(p_id uuid, p_project_id uuid, p_fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid(); f jsonb := coalesce(p_fields, '{}'::jsonb); t public.pp_tasks%ROWTYPE;
  v_id uuid; v_owner uuid; v_pname text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_id IS NULL THEN
    IF p_project_id IS NULL THEN RAISE EXCEPTION 'Choose a project'; END IF;
    IF NOT public._pp_can_manage(p_project_id, v_me) THEN RAISE EXCEPTION 'Only an admin, a manager or the plan owner can add tasks'; END IF;
    IF nullif(trim(coalesce(f->>'title','')), '') IS NULL THEN RAISE EXCEPTION 'Enter a task title'; END IF;
    -- the project gets a plan the first time a task is added
    INSERT INTO public.pp_plans (project_id, owner_id, created_by) VALUES (p_project_id, v_me, v_me) ON CONFLICT (project_id) DO NOTHING;
    v_owner := coalesce(nullif(f->>'owner_id','')::uuid, v_me);
    INSERT INTO public.pp_tasks (project_id, title, description, priority, owner_id, est_start, est_finish, est_duration_days, deliverables, created_by)
    VALUES (p_project_id, trim(f->>'title'), nullif(f->>'description',''), coalesce(nullif(f->>'priority',''), 'Medium'), v_owner,
            nullif(f->>'est_start','')::date, nullif(f->>'est_finish','')::date, nullif(f->>'est_duration_days','')::numeric,
            nullif(f->>'deliverables',''), v_me)
    RETURNING id INTO v_id;
    SELECT name INTO v_pname FROM public.projects WHERE id = p_project_id;
    PERFORM public._pp_notify(v_owner, 'new task for you', trim(f->>'title') || coalesce(' — ' || v_pname, ''), v_id);
    RETURN v_id;
  END IF;

  SELECT * INTO t FROM public.pp_tasks WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF NOT public._pp_can_manage(t.project_id, v_me) THEN
    -- the task owner may only update % complete
    IF t.owner_id = v_me AND (SELECT bool_and(k = 'percent_complete') FROM jsonb_object_keys(f) k) THEN
      UPDATE public.pp_tasks SET percent_complete = least(100, greatest(0, coalesce(nullif(f->>'percent_complete','')::numeric, 0))), updated_at = now() WHERE id = p_id;
      RETURN p_id;
    END IF;
    RAISE EXCEPTION 'Only an admin, a manager or the plan owner can change these details';
  END IF;
  IF f ? 'title' AND nullif(trim(coalesce(f->>'title','')), '') IS NULL THEN RAISE EXCEPTION 'Enter a task title'; END IF;

  UPDATE public.pp_tasks SET
    title             = CASE WHEN f ? 'title'             THEN trim(f->>'title') ELSE title END,
    description       = CASE WHEN f ? 'description'       THEN nullif(f->>'description','') ELSE description END,
    priority          = CASE WHEN f ? 'priority'          THEN coalesce(nullif(f->>'priority',''), 'Medium') ELSE priority END,
    percent_complete  = CASE WHEN f ? 'percent_complete'  THEN least(100, greatest(0, coalesce(nullif(f->>'percent_complete','')::numeric, 0))) ELSE percent_complete END,
    owner_id          = CASE WHEN nullif(f->>'owner_id','') IS NOT NULL THEN (f->>'owner_id')::uuid ELSE owner_id END,
    est_start         = CASE WHEN f ? 'est_start'         THEN nullif(f->>'est_start','')::date ELSE est_start END,
    est_finish        = CASE WHEN f ? 'est_finish'        THEN nullif(f->>'est_finish','')::date ELSE est_finish END,
    est_duration_days = CASE WHEN f ? 'est_duration_days' THEN nullif(f->>'est_duration_days','')::numeric ELSE est_duration_days END,
    actual_start      = CASE WHEN f ? 'actual_start'      THEN nullif(f->>'actual_start','')::date ELSE actual_start END,
    actual_finish     = CASE WHEN f ? 'actual_finish'     THEN nullif(f->>'actual_finish','')::date ELSE actual_finish END,
    deliverables      = CASE WHEN f ? 'deliverables'      THEN nullif(f->>'deliverables','') ELSE deliverables END,
    updated_at        = now()
  WHERE id = p_id
  RETURNING owner_id INTO v_owner;
  IF v_owner IS DISTINCT FROM t.owner_id THEN
    PERFORM public._pp_notify(v_owner, 'task assigned to you', t.title, p_id);
  END IF;
  RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pp_delete_task(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project uuid;
BEGIN
  SELECT project_id INTO v_project FROM public.pp_tasks WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF NOT public._pp_can_manage(v_project, auth.uid()) THEN RAISE EXCEPTION 'Only an admin, a manager or the plan owner can delete tasks'; END IF;
  DELETE FROM public.pp_tasks WHERE id = p_id;
  INSERT INTO public.pp_history (entity, entity_id, user_id, action, state, description)
  VALUES ('task', p_id, auth.uid(), 'Delete', NULL, 'Task deleted');
END;
$$;

-- ── lifecycle ───────────────────────────────────────────────────────────────
-- Owner (or admin / plan owner): one step up to In Approval (choosing an approver), one step down.
-- Approver or admin: In Approval → Completed (approve) or back to In Work (send back, with a comment).
-- Admin / plan owner: reopen a Completed task (→ In Work).
CREATE OR REPLACE FUNCTION public.pp_move_task(p_id uuid, p_to text, p_approver uuid DEFAULT NULL, p_comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid(); t public.pp_tasks%ROWTYPE; v_from int; v_to int;
  v_manage boolean; v_owner boolean; v_decider boolean; v_comment text := nullif(trim(coalesce(p_comment,'')), '');
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_to NOT IN ('draft','todo','in_work','in_approval','completed') THEN RAISE EXCEPTION 'Unknown state'; END IF;
  SELECT * INTO t FROM public.pp_tasks WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF t.maturity = p_to THEN RETURN; END IF;

  v_from := public._pp_rank(t.maturity); v_to := public._pp_rank(p_to);
  v_manage  := public._pp_can_manage(t.project_id, v_me);
  v_owner   := t.owner_id IS NOT DISTINCT FROM v_me;
  v_decider := t.approver_id IS NOT DISTINCT FROM v_me OR EXISTS (SELECT 1 FROM public.profiles WHERE id = v_me AND role IN ('admin','super_admin'));

  IF t.maturity = 'completed' THEN
    IF NOT v_manage THEN RAISE EXCEPTION 'Only an admin or the plan owner can reopen a completed task'; END IF;
    IF p_to <> 'in_work' THEN RAISE EXCEPTION 'A completed task can only be reopened to In Work'; END IF;
    UPDATE public.pp_tasks SET maturity = 'in_work', actual_finish = NULL, updated_at = now() WHERE id = p_id;
    IF v_comment IS NOT NULL THEN
      INSERT INTO public.pp_history (entity, entity_id, user_id, action, state, description) VALUES ('task', p_id, v_me, 'Comment', 'In Work', v_comment);
    END IF;
    PERFORM public._pp_notify(t.owner_id, 'task reopened', t.title || coalesce(' — ' || v_comment, ''), p_id);
    RETURN;
  END IF;

  IF t.maturity = 'in_approval' THEN
    IF p_to = 'completed' THEN
      IF NOT v_decider THEN RAISE EXCEPTION 'Only the approver or an admin can approve this task'; END IF;
      UPDATE public.pp_approvals SET status = 'approved', comment = v_comment, decided_at = now()
       WHERE task_id = p_id AND status = 'pending';
      UPDATE public.pp_tasks SET maturity = 'completed', percent_complete = 100,
             actual_finish = coalesce(actual_finish, current_date), updated_at = now() WHERE id = p_id;
      PERFORM public._pp_notify(t.owner_id, 'task approved', t.title || coalesce(' — ' || v_comment, ''), p_id);
      RETURN;
    END IF;
    IF v_decider AND NOT v_owner THEN
      IF v_comment IS NULL THEN RAISE EXCEPTION 'Add a comment saying why it is sent back'; END IF;
      UPDATE public.pp_approvals SET status = 'rejected', comment = v_comment, decided_at = now() WHERE task_id = p_id AND status = 'pending';
      UPDATE public.pp_tasks SET maturity = 'in_work', updated_at = now() WHERE id = p_id;
      PERFORM public._pp_notify(t.owner_id, 'task sent back', t.title || ' — ' || v_comment, p_id);
      RETURN;
    END IF;
    IF NOT (v_owner OR v_manage) THEN RAISE EXCEPTION 'Not allowed'; END IF;
    UPDATE public.pp_approvals SET status = 'withdrawn', comment = v_comment, decided_at = now() WHERE task_id = p_id AND status = 'pending';
    UPDATE public.pp_tasks SET maturity = 'in_work', updated_at = now() WHERE id = p_id;
    PERFORM public._pp_notify(t.approver_id, 'approval withdrawn', t.title, p_id);
    RETURN;
  END IF;

  IF NOT (v_owner OR v_manage) THEN RAISE EXCEPTION 'Only the task owner, the plan owner or an admin can move this task'; END IF;
  IF p_to = 'completed' THEN RAISE EXCEPTION 'Send the task for approval first'; END IF;
  IF abs(v_to - v_from) <> 1 THEN RAISE EXCEPTION 'Move one step at a time'; END IF;

  IF p_to = 'in_approval' THEN
    IF p_approver IS NULL THEN RAISE EXCEPTION 'Choose who approves this task'; END IF;
    IF p_approver = v_me THEN RAISE EXCEPTION 'Choose someone else to approve your task'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_approver AND coalesce(is_active, true)
                     AND role IN ('admin','super_admin','manager')) THEN
      RAISE EXCEPTION 'The approver must be a manager or an admin';
    END IF;
    UPDATE public.pp_tasks SET maturity = 'in_approval', approver_id = p_approver, updated_at = now() WHERE id = p_id;
    INSERT INTO public.pp_approvals (task_id, approver_id, requested_by, instructions) VALUES (p_id, p_approver, v_me, v_comment);
    PERFORM public._pp_notify(p_approver, 'task waiting for your approval',
      public._pp_name(v_me) || ' sent "' || t.title || '" for approval' || coalesce(' — ' || v_comment, ''), p_id);
    RETURN;
  END IF;

  UPDATE public.pp_tasks SET maturity = p_to,
         actual_start = CASE WHEN p_to = 'in_work' THEN coalesce(actual_start, current_date) ELSE actual_start END,
         updated_at = now()
   WHERE id = p_id;
  IF v_comment IS NOT NULL THEN
    INSERT INTO public.pp_history (entity, entity_id, user_id, action, state, description)
    VALUES ('task', p_id, v_me, 'Comment', public._pp_state_label(p_to), v_comment);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pp_projects() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pp_save_plan(uuid, text, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pp_move_plan(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pp_save_task(uuid, uuid, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pp_delete_task(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pp_move_task(uuid, text, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pp_projects(), public.pp_save_plan(uuid, text, jsonb), public.pp_move_plan(uuid, text),
  public.pp_save_task(uuid, uuid, jsonb), public.pp_delete_task(uuid), public.pp_move_task(uuid, text, uuid, text) TO authenticated;

-- live updates
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY['pp_plans','pp_tasks','pp_approvals','pp_history'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
