-- ============================================================
-- FIX: Add parent_id to task_comments for threaded replies
-- Run this in your Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Add the parent_id column (safe to run even if already exists)
ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.task_comments(id) ON DELETE CASCADE;

-- 2. Index for fast reply lookups
CREATE INDEX IF NOT EXISTS idx_task_comments_parent_id
  ON public.task_comments(parent_id);

-- 3. Update RLS policy so ALL assignees (not just assigned_to) can comment
--    (Required because tasks now support multi-assignees via task_assignees table)
DROP POLICY IF EXISTS "Users can read comments on visible tasks" ON public.task_comments;
DROP POLICY IF EXISTS "Users can insert comments on visible tasks" ON public.task_comments;

CREATE POLICY "Users can read comments on visible tasks"
  ON public.task_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks
      WHERE tasks.id = task_comments.task_id
        AND (
          tasks.assigned_to = auth.uid()
          OR public.is_admin(auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.task_assignees ta
            WHERE ta.task_id = task_comments.task_id
              AND ta.user_id = auth.uid()
          )
        )
    )
  );

CREATE POLICY "Users can insert comments on visible tasks"
  ON public.task_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.tasks
      WHERE tasks.id = task_comments.task_id
        AND (
          tasks.assigned_to = auth.uid()
          OR public.is_admin(auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.task_assignees ta
            WHERE ta.task_id = task_comments.task_id
              AND ta.user_id = auth.uid()
          )
        )
    )
  );
