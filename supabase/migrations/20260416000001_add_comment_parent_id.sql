-- Add parent_id to task_comments for threaded replies
ALTER TABLE task_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES task_comments(id) ON DELETE CASCADE;

-- Index for fast parent lookups
CREATE INDEX IF NOT EXISTS idx_task_comments_parent_id ON task_comments(parent_id);
