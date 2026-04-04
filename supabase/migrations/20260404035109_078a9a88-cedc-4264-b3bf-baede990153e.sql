INSERT INTO storage.buckets (id, name, public)
VALUES ('task-attachments', 'task-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload task attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'task-attachments');

CREATE POLICY "Authenticated users can read task attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'task-attachments');

CREATE POLICY "Admins and managers can delete task attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'task-attachments' AND public.is_admin(auth.uid()));