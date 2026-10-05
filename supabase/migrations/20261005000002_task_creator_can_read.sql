-- Whoever created a task can always see it (e.g. a manager assigning outside their team)
DROP POLICY IF EXISTS "Creators can read their tasks" ON public.tasks;
CREATE POLICY "Creators can read their tasks"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (assigned_by = auth.uid());
