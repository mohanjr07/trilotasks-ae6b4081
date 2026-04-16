-- ============================================================
-- FIX 1: Infinite recursion in task_assignees policies
-- Drop all existing policies and replace with non-recursive ones
-- ============================================================

DROP POLICY IF EXISTS "Users can read own assignments" ON public.task_assignees;
DROP POLICY IF EXISTS "Admins can manage task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can see assignees of their tasks" ON public.task_assignees;
DROP POLICY IF EXISTS "Users can read own task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Managers can insert task_assignees" ON public.task_assignees;

-- Admins/managers can do everything on task_assignees
CREATE POLICY "Admins can manage task_assignees"
  ON public.task_assignees FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Any authenticated user can read task_assignees rows where they are the user
-- This is a direct equality check — no sub-selects → no recursion
CREATE POLICY "Users can read own task_assignees"
  ON public.task_assignees FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- FIX 2: Tasks SELECT policy for employees
-- Employees can see tasks where they are in task_assignees
-- ============================================================

DROP POLICY IF EXISTS "Employees can read own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Employees can update own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Employees can read assigned tasks" ON public.tasks;
DROP POLICY IF EXISTS "Employees can update assigned tasks" ON public.tasks;

-- Employees can see tasks where they are in task_assignees
CREATE POLICY "Employees can read assigned tasks"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR auth.uid() = assigned_to
    OR EXISTS (
      SELECT 1 FROM public.task_assignees ta
      WHERE ta.task_id = tasks.id
        AND ta.user_id = auth.uid()
    )
  );

-- Employees can update tasks assigned to them
CREATE POLICY "Employees can update assigned tasks"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR auth.uid() = assigned_to
    OR EXISTS (
      SELECT 1 FROM public.task_assignees ta
      WHERE ta.task_id = tasks.id
        AND ta.user_id = auth.uid()
    )
  );

-- ============================================================
-- FIX 3: Task comments visibility for assigned users
-- ============================================================

DROP POLICY IF EXISTS "Users can read comments on visible tasks" ON public.task_comments;

CREATE POLICY "Users can read comments on visible tasks"
  ON public.task_comments FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_comments.task_id
        AND (
          t.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.task_assignees ta
            WHERE ta.task_id = t.id AND ta.user_id = auth.uid()
          )
        )
    )
  );

-- ============================================================
-- FIX 4: Allow task_assignees INSERT for the task creator
-- Without this, non-admin creators cannot insert task_assignees rows
-- ============================================================

DROP POLICY IF EXISTS "Managers can insert task_assignees" ON public.task_assignees;

-- Allow any authenticated user to insert task_assignees for tasks they created
CREATE POLICY "Task creators can insert task_assignees"
  ON public.task_assignees FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_assignees.task_id
        AND t.assigned_by = auth.uid()
    )
  );
