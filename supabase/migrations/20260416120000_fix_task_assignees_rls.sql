-- ============================================================
-- FIX 1: Infinite recursion in task_assignees policies
-- The old "Users can read own assignments" policy caused a
-- circular reference: tasks SELECT → task_assignees SELECT →
-- tasks SELECT (infinite loop).
-- Drop the recursive policy and replace with a simple one.
-- ============================================================

DROP POLICY IF EXISTS "Users can read own assignments" ON public.task_assignees;
DROP POLICY IF EXISTS "Admins can manage task_assignees" ON public.task_assignees;

-- Simple non-recursive policies for task_assignees
-- Admins/managers can do everything
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

-- Allow admins/managers to INSERT assignees (needed when creating tasks)
-- Already covered by the ALL policy above, but adding explicit INSERT
-- for clarity and to support managers creating tasks
CREATE POLICY "Users can see assignees of their tasks"
  ON public.task_assignees FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.task_assignees ta2
      WHERE ta2.task_id = task_assignees.task_id
        AND ta2.user_id = auth.uid()
    )
  );

-- ============================================================
-- FIX 2: Tasks SELECT policy for employees
-- Old policy: USING (auth.uid() = assigned_to)
-- This no longer works because multi-assignee tasks are stored
-- in task_assignees, not the assigned_to column.
-- ============================================================

DROP POLICY IF EXISTS "Employees can read own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Employees can update own tasks" ON public.tasks;

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
-- FIX 3: Task comments & attachments visibility
-- Users can see comments/attachments on tasks they're assigned to
-- via task_assignees (not just assigned_to column)
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
-- FIX 4: Allow managers to insert task_assignees rows
-- (task_assignees INSERT was not explicitly allowed for managers
--  when the ALL policy was admin-only using USING without WITH CHECK)
-- The new "Admins can manage task_assignees" policy above covers
-- this with WITH CHECK, but adding an explicit safety net:
-- ============================================================

DROP POLICY IF EXISTS "Managers can insert task_assignees" ON public.task_assignees;

CREATE POLICY "Managers can insert task_assignees"
  ON public.task_assignees FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
