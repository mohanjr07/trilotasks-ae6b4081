-- Private bucket for the filled-in Word copies shown in Microsoft's Office viewer
INSERT INTO storage.buckets (id, name, public)
VALUES ('form-copies', 'form-copies', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "form_copies_rw" ON storage.objects;
CREATE POLICY "form_copies_rw" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'form-copies')
  WITH CHECK (bucket_id = 'form-copies');
