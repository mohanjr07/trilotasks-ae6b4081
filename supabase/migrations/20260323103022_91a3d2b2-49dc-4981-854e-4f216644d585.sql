
-- 1. Update any super_admin to admin
UPDATE profiles SET role = 'admin' WHERE role = 'super_admin';

-- 2. Drop old RLS policy that references super_admin
DROP POLICY IF EXISTS "Super admins can delete profiles" ON profiles;

-- 3. Create new delete policy for admins
CREATE POLICY "Admins can delete profiles" ON profiles
FOR DELETE TO authenticated
USING (is_admin(auth.uid()));

-- 4. Create notification_preferences table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  pref_key text NOT NULL,
  is_enabled boolean DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, pref_key)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own prefs" ON notification_preferences
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prefs" ON notification_preferences
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prefs" ON notification_preferences
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- 5. Create leave_policy table
CREATE TABLE IF NOT EXISTS public.leave_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_type text NOT NULL UNIQUE,
  allowed_days numeric DEFAULT 0,
  is_enabled boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.leave_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read leave policy" ON leave_policy
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage leave policy" ON leave_policy
FOR ALL TO authenticated USING (is_admin(auth.uid()));

-- Insert default leave policy
INSERT INTO leave_policy (leave_type, allowed_days, is_enabled) VALUES
  ('annual', 12, true),
  ('sick', 10, true),
  ('emergency', 3, true),
  ('unpaid', 0, true),
  ('permission_hours', 24, true)
ON CONFLICT (leave_type) DO NOTHING;

-- 6. Allow admins to insert notifications (for triggers)
CREATE POLICY "System can insert notifications" ON notifications
FOR INSERT TO authenticated WITH CHECK (true);

-- 7. Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- 8. Create notification trigger functions

-- Trigger: Task assigned
CREATE OR REPLACE FUNCTION public.notify_task_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (user_id, title, body, type, reference_id)
  VALUES (
    NEW.assigned_to,
    'New task assigned',
    'You have been assigned: ' || NEW.title,
    'task',
    NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_assigned ON tasks;
CREATE TRIGGER trg_notify_task_assigned
AFTER INSERT ON tasks
FOR EACH ROW
EXECUTE FUNCTION notify_task_assigned();

-- Trigger: Task progress updated
CREATE OR REPLACE FUNCTION public.notify_task_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_name text;
BEGIN
  IF OLD.progress IS DISTINCT FROM NEW.progress THEN
    SELECT full_name INTO emp_name FROM profiles WHERE id = NEW.assigned_to;
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (
      NEW.assigned_by,
      emp_name || ' updated progress',
      NEW.title || ' is now ' || NEW.progress || '% complete',
      'task',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_progress ON tasks;
CREATE TRIGGER trg_notify_task_progress
AFTER UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION notify_task_progress();

-- Trigger: Task completed
CREATE OR REPLACE FUNCTION public.notify_task_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_name text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' THEN
    SELECT full_name INTO emp_name FROM profiles WHERE id = NEW.assigned_to;
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (
      NEW.assigned_by,
      'Task completed ✓',
      emp_name || ' completed: ' || NEW.title,
      'task',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_completed ON tasks;
CREATE TRIGGER trg_notify_task_completed
AFTER UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION notify_task_completed();

-- Trigger: Leave request submitted
CREATE OR REPLACE FUNCTION public.notify_leave_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_name text;
  admin_id uuid;
BEGIN
  SELECT full_name INTO emp_name FROM profiles WHERE id = NEW.employee_id;
  FOR admin_id IN SELECT id FROM profiles WHERE role = 'admin' AND id != NEW.employee_id
  LOOP
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (
      admin_id,
      'New ' || NEW.type || ' request',
      emp_name || ' requested ' || NEW.type || ': ' || NEW.start_date,
      'leave',
      NEW.id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_leave_submitted ON leave_requests;
CREATE TRIGGER trg_notify_leave_submitted
AFTER INSERT ON leave_requests
FOR EACH ROW
EXECUTE FUNCTION notify_leave_submitted();

-- Trigger: Leave request reviewed
CREATE OR REPLACE FUNCTION public.notify_leave_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (
      NEW.employee_id,
      CASE WHEN NEW.status = 'approved' THEN 'Request approved ✓' ELSE 'Request rejected' END,
      'Your ' || NEW.type || ' request for ' || NEW.start_date ||
        CASE WHEN NEW.status = 'approved' THEN ' was approved' 
        ELSE ' was rejected' || COALESCE('. ' || NEW.admin_note, '') END,
      'leave',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_leave_reviewed ON leave_requests;
CREATE TRIGGER trg_notify_leave_reviewed
AFTER UPDATE ON leave_requests
FOR EACH ROW
EXECUTE FUNCTION notify_leave_reviewed();
