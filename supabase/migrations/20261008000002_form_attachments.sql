-- Documents attached to form requests (Material IN / OUT) — private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('form-attachments', 'form-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- upload only into your own folder (<user id>/...)
DROP POLICY IF EXISTS form_attachments_insert ON storage.objects;
CREATE POLICY form_attachments_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'form-attachments' AND split_part(name, '/', 1) = auth.uid()::text);

-- read: the uploader, or anyone who can see the request it is attached to
DROP POLICY IF EXISTS form_attachments_read ON storage.objects;
CREATE POLICY form_attachments_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'form-attachments'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.form_requests fr
        WHERE fr.data->'attachments' @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
          AND (fr.requested_by = auth.uid() OR fr.approver_id = auth.uid() OR fr.authorizer_id = auth.uid())
      )
    )
  );

-- remove: the uploader (their own files) or admins
DROP POLICY IF EXISTS form_attachments_delete ON storage.objects;
CREATE POLICY form_attachments_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'form-attachments' AND (split_part(name, '/', 1) = auth.uid()::text OR public.is_admin(auth.uid())));
