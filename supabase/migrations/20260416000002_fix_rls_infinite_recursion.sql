-- ============================================================
-- FIX: Infinite recursion in task_assignees RLS policies
-- ROOT CAUSE: Policies on tasks/comments/attachments were
-- referencing task_assignees, which itself referenced tasks,
-- creating a circular dependency that PostgreSQL can't resolve.
-- SOLUTION: Use a SECURITY DEFINER helper function to check
-- task visibility without triggering RLS recursion.
-- ============================================================

-- ── Step 1: Drop all existing policies that cause the loop ──

DROP POLICY IF EXISTS "Admins can manage task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can read own assignments" ON public.task_assignees;

DROP POLICY IF EXISTS "Admins can do all on tasks" ON public.tasks;
DROP POLICY IF EXISTS "Employees can read own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Employees can update own tasks" ON public.tasks;

DROP POLICY IF EXISTS "Users can read comments on visible tasks" ON public.task_comments;
DROP POLICY IF EXISTS "Users can insert comments on visible tasks" ON public.task_comments;

DROP POLICY IF EXISTS "Users can read attachments on visible tasks" ON public.task_attachments;
DROP POLICY IF EXISTS "Users can insert attachments on visible tasks" ON public.task_attachments;

-- ── Step 2: Create a SECURITY DEFINER function that bypasses RLS ──
-- This function checks task visibility WITHOUT triggering RLS on
-- any table, eliminating all circular dependency issues.

CREATE OR REPLACE FUNCTION public.user_can_access_task(task_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_id
      AND (
        -- User is the primary assignee (legacy column)
        t.assigned_to = uid
        OR
        -- User is in the multi-assignee table (direct lookup, no RLS)
        EXISTS (
          SELECT 1 FROM public.task_assignees ta
          WHERE ta.task_id = t.id AND ta.user_id = uid
        )
        OR
        -- User is an admin/super_admin (direct lookup, no RLS)
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = uid AND p.role IN ('admin', 'super_admin')
        )
      )
  )
$$;

-- ── Step 3: Recreate task_assignees policies (simple, no joins) ──

-- Admins can fully manage assignments
CREATE POLICY "Admins can manage task_assignees"
  ON public.task_assignees FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Users can read rows where they are the assignee
CREATE POLICY "Users can read own task_assignees"
  ON public.task_assignees FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ── Step 4: Recreate tasks policies ──

-- Admins: full access
CREATE POLICY "Admins can do all on tasks"
  ON public.tasks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- Employees: read tasks they are assigned to (either column or junction)
CREATE POLICY "Employees can read assigned tasks"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (
    auth.uid() = assigned_to
    OR EXISTS (
      SELECT 1 FROM public.task_assignees
      WHERE task_id = tasks.id AND user_id = auth.uid()
    )
  );

-- Employees: update tasks they are assigned to
CREATE POLICY "Employees can update assigned tasks"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = assigned_to
    OR EXISTS (
      SELECT 1 FROM public.task_assignees
      WHERE task_id = tasks.id AND user_id = auth.uid()
    )
  );

-- ── Step 5: Recreate task_comments policies ──

CREATE POLICY "Users can read comments on accessible tasks"
  ON public.task_comments FOR SELECT
  TO authenticated
  USING (public.user_can_access_task(task_id, auth.uid()));

CREATE POLICY "Users can insert comments on accessible tasks"
  ON public.task_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_can_access_task(task_id, auth.uid())
  );

-- ── Step 6: Recreate task_attachments policies ──

CREATE POLICY "Users can read attachments on accessible tasks"
  ON public.task_attachments FOR SELECT
  TO authenticated
  USING (public.user_can_access_task(task_id, auth.uid()));

CREATE POLICY "Users can insert attachments on accessible tasks"
  ON public.task_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = uploaded_by
    AND public.user_can_access_task(task_id, auth.uid())
  );

-- Allow admins to delete attachments
CREATE POLICY "Admins can delete attachments"
  ON public.task_attachments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );

-- ── Step 7: Allow admins to insert notifications for any user ──
-- (needed so admin can notify all assignees on task creation)
DROP POLICY IF EXISTS "Admins can insert notifications" ON public.notifications;
CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );
