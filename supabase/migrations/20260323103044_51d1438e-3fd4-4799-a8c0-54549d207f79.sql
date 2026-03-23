
-- Fix overly permissive INSERT policy on notifications - restrict to triggers only via security definer functions
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;

-- Admins can insert notifications  
CREATE POLICY "Admins can insert notifications" ON notifications
FOR INSERT TO authenticated WITH CHECK (is_admin(auth.uid()));
