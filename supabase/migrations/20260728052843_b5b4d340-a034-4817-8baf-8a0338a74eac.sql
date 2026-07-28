
-- =========================================================
-- 1. Enable RLS on tasks and task_assignees
-- =========================================================
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 2. Clean up task_assignees policies (remove broken self-ref + duplicates)
-- =========================================================
DROP POLICY IF EXISTS "users can see task assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "users see their own assignments" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can view their assignments" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can remove their assignments" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can assign tasks" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can read own task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can read assignees of their tasks" ON public.task_assignees;
DROP POLICY IF EXISTS "Task creators can insert task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Creators can manage assignees for their tasks" ON public.task_assignees;
DROP POLICY IF EXISTS "Intern admins can manage task assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Admins can manage task_assignees" ON public.task_assignees;

CREATE POLICY "ta_admin_all" ON public.task_assignees
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- A signed-in user can see assignee rows for tasks they own or are assigned to.
CREATE POLICY "ta_visible_to_task_participants" ON public.task_assignees
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_assignees.task_id
        AND (t.assigned_by = auth.uid() OR t.assigned_to = auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.task_assignees ta2
      WHERE ta2.task_id = task_assignees.task_id
        AND ta2.user_id = auth.uid()
    )
  );

-- Only task creators (or admins via ta_admin_all) can add assignees.
CREATE POLICY "ta_creator_insert" ON public.task_assignees
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_assignees.task_id
        AND t.assigned_by = auth.uid()
    )
  );

CREATE POLICY "ta_creator_delete" ON public.task_assignees
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_assignees.task_id
        AND t.assigned_by = auth.uid()
    )
  );

-- =========================================================
-- 3. Projects / project_teams / project_members - remove duplicate {public} policies
-- =========================================================
DROP POLICY IF EXISTS "project_members_select" ON public.project_members;
DROP POLICY IF EXISTS "project_members_insert" ON public.project_members;
DROP POLICY IF EXISTS "project_members_update" ON public.project_members;
DROP POLICY IF EXISTS "project_members_delete" ON public.project_members;

DROP POLICY IF EXISTS "project_teams_select" ON public.project_teams;
DROP POLICY IF EXISTS "project_teams_insert" ON public.project_teams;
DROP POLICY IF EXISTS "project_teams_update" ON public.project_teams;
DROP POLICY IF EXISTS "project_teams_delete" ON public.project_teams;

DROP POLICY IF EXISTS "projects_select" ON public.projects;
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_update" ON public.projects;
DROP POLICY IF EXISTS "projects_delete" ON public.projects;

-- =========================================================
-- 4. Profiles - tighten broad read policies
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can read basic profile info" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;

CREATE POLICY "profiles_self_read" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_admin_read" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "profiles_admin_insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Keep "Authenticated users can read all profiles" (already authenticated-scoped)
-- so the directory pages keep working. The removal above eliminates the anon-facing
-- duplicate and the finding about {public}-scoped duplicates.

-- =========================================================
-- 5. Task attachments - add UPDATE/DELETE policies
-- =========================================================
DROP POLICY IF EXISTS "ta_att_admin_all" ON public.task_attachments;
DROP POLICY IF EXISTS "ta_att_uploader_delete" ON public.task_attachments;

CREATE POLICY "ta_att_admin_all" ON public.task_attachments
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "ta_att_uploader_delete" ON public.task_attachments
  FOR DELETE TO authenticated
  USING (auth.uid() = uploaded_by);

-- =========================================================
-- 6. Storage policies for task-attachments bucket (now private)
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can read task attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload task attachments" ON storage.objects;
DROP POLICY IF EXISTS "Admins and managers can delete task attachments" ON storage.objects;

-- Read: admins OR users who can see the referenced task_attachments row.
CREATE POLICY "task_attachments_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-attachments'
    AND (
      public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.task_attachments a
        JOIN public.tasks t ON t.id = a.task_id
        WHERE a.file_url LIKE '%' || storage.objects.name
          AND (
            t.assigned_by = auth.uid()
            OR t.assigned_to = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.task_assignees ta
              WHERE ta.task_id = t.id AND ta.user_id = auth.uid()
            )
          )
      )
    )
  );

CREATE POLICY "task_attachments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-attachments' AND auth.uid() IS NOT NULL
  );

CREATE POLICY "task_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'task-attachments' AND public.is_admin(auth.uid())
  );

-- =========================================================
-- 7. Fix function search_path on trigger/helper functions missing it
-- =========================================================
ALTER FUNCTION public.handle_assets_updated_at() SET search_path = public;
ALTER FUNCTION public.handle_kra_kpi_updated_at() SET search_path = public;
ALTER FUNCTION public.get_task_comment_recipients(uuid, uuid) SET search_path = public;

-- =========================================================
-- 8. Revoke EXECUTE on internal/trigger SECURITY DEFINER functions
--    (Trigger functions are invoked by the DB, not clients.)
-- =========================================================
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_leave_reviewed() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_leave_submitted() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_meeting_participants() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_task_assigned() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_task_completed() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.notify_task_progress() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.send_email_on_notification() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_assets_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_kra_kpi_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;

-- Helper security-definer functions used by RLS - revoke anon (RLS runs as
-- calling role; only signed-in requests need to evaluate them).
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_strict_admin(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_active_profiles() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_task_comment_recipients(uuid, uuid) FROM anon, public;
