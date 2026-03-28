
-- Re-create triggers that are missing

-- Task assigned trigger
CREATE OR REPLACE TRIGGER on_task_assigned
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_assigned();

-- Task progress trigger
CREATE OR REPLACE TRIGGER on_task_progress
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_progress();

-- Task completed trigger
CREATE OR REPLACE TRIGGER on_task_completed
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_completed();

-- Leave submitted trigger
CREATE OR REPLACE TRIGGER on_leave_submitted
  AFTER INSERT ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_leave_submitted();

-- Leave reviewed trigger
CREATE OR REPLACE TRIGGER on_leave_reviewed
  AFTER UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_leave_reviewed();

-- Meeting participant added trigger
CREATE OR REPLACE TRIGGER on_meeting_participant_added
  AFTER INSERT ON public.team_meeting_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_meeting_participants();

-- Create avatars storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload their own avatar
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow authenticated users to update their own avatar
CREATE POLICY "Users can update own avatar"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Allow anyone to read avatars (public bucket)
CREATE POLICY "Anyone can read avatars"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'avatars');

-- Allow admin to delete leave requests (clear)
CREATE POLICY "Admins can delete leave_requests"
ON public.leave_requests FOR DELETE TO authenticated
USING (is_admin(auth.uid()));

-- Allow users to delete own notifications
CREATE POLICY "Users can delete own notifications"
ON public.notifications FOR DELETE TO authenticated
USING (auth.uid() = user_id);
