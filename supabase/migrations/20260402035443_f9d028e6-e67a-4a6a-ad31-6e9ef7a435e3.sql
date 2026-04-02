
-- Create task_assignees junction table for multi-user task assignment
CREATE TABLE public.task_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(task_id, user_id)
);

-- Enable RLS
ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

-- Admins/managers can manage all assignments
CREATE POLICY "Admins can manage task_assignees"
  ON public.task_assignees FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()));

-- Users can read their own assignments
CREATE POLICY "Users can read own assignments"
  ON public.task_assignees FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Migrate existing tasks.assigned_to data into task_assignees
INSERT INTO public.task_assignees (task_id, user_id)
SELECT id, assigned_to FROM public.tasks
ON CONFLICT (task_id, user_id) DO NOTHING;
