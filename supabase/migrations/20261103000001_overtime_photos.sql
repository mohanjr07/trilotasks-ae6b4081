-- ─────────────────────────────────────────────────────────────────────────────
--  Overtime photos: every overtime entry needs at least one photo
--  (taken with the camera or picked from files).
--  • Photos go to the private storage bucket "overtime-photos".
--  • overtime_entries.photo_paths keeps the file paths; all people entered
--    together share the same photos.
--  • Managers/admins upload; everyone who can open Overtime can view.
--  Run in the Trilo Attendance Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.projects WHERE name = 'Coldstar_PUNE - G+2 Spiral Chute') THEN RAISE EXCEPTION 'Wrong database — run this in the Trilo Attendance project'; END IF; END $$;

ALTER TABLE public.overtime_entries ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT '{}';

-- private bucket, images only, 10 MB each
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('overtime-photos', 'overtime-photos', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS ot_photos_read ON storage.objects;
CREATE POLICY ot_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'overtime-photos' AND public.can_see_overtime(auth.uid()));

DROP POLICY IF EXISTS ot_photos_insert ON storage.objects;
CREATE POLICY ot_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'overtime-photos'
              AND (storage.foldername(name))[1] = auth.uid()::text
              AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')));

DROP POLICY IF EXISTS ot_photos_delete ON storage.objects;
CREATE POLICY ot_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'overtime-photos'
         AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin(auth.uid())));

-- add_overtime_entries now takes the photo paths (at least one is required)
DROP FUNCTION IF EXISTS public.add_overtime_entries(date, jsonb, text);
DROP FUNCTION IF EXISTS public.add_overtime_entries(date, jsonb, text, text[]);
CREATE FUNCTION public.add_overtime_entries(p_date date, p_entries jsonb, p_note text DEFAULT NULL, p_photos text[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e jsonb; v_emp uuid; v_half text; v_start time; v_end time; v_mins integer;
  v_me text; v_anu uuid; v_hari uuid; v_is_hari boolean; v_lines text := ''; v_count integer := 0; v_name text; v_when text;
  v_photos text[]; v_photo_txt text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'Only managers and admins can enter overtime';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'Select at least one name';
  END IF;
  SELECT coalesce(array_agg(x), '{}') INTO v_photos
    FROM unnest(coalesce(p_photos, '{}')) x
   WHERE nullif(trim(x), '') IS NOT NULL;
  IF cardinality(v_photos) = 0 THEN
    RAISE EXCEPTION 'Attach at least one photo';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_photos) x WHERE split_part(x, '/', 1) <> auth.uid()::text) THEN
    RAISE EXCEPTION 'Invalid photo';
  END IF;
  v_photo_txt := E'\n📷 ' || cardinality(v_photos) || CASE WHEN cardinality(v_photos) = 1 THEN ' photo attached' ELSE ' photos attached' END;

  SELECT id INTO v_hari FROM profiles WHERE lower(email) = 'hari@triloautomation.com' LIMIT 1;
  v_is_hari := (v_hari IS NOT NULL AND v_hari = auth.uid()) OR v_hari IS NULL;

  FOR e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_emp  := (e->>'employee_id')::uuid;
    v_half := e->>'half';
    IF NOT EXISTS (SELECT 1 FROM overtime_members m WHERE m.employee_id = v_emp) THEN
      RAISE EXCEPTION 'Only people on the OT members list can be selected';
    END IF;
    IF v_half = 'full' THEN
      v_start := NULL; v_end := NULL; v_mins := 540;   -- full day = 9 hours
      v_when := 'Full day';
    ELSIF v_half IN ('other','first','second') THEN
      v_start := nullif(e->>'start_time', '')::time;
      v_end   := nullif(e->>'end_time', '')::time;
      IF v_start IS NULL OR v_end IS NULL THEN RAISE EXCEPTION 'Enter the start and end time'; END IF;
      v_mins := (extract(epoch FROM (v_end - v_start)) / 60)::int;
      IF v_mins <= 0 THEN v_mins := v_mins + 1440; END IF;
      IF v_mins > 960 THEN RAISE EXCEPTION 'Overtime of more than 16 hours — please check the times'; END IF;
      v_when := to_char(v_start, 'HH12:MI AM') || ' to ' || to_char(v_end, 'HH12:MI AM');
    ELSE
      RAISE EXCEPTION 'Choose Full day or Other time';
    END IF;

    INSERT INTO overtime_entries (work_date, employee_id, half, start_time, end_time, duration_hours, note,
                                  photo_paths, created_by, verified_by, verified_at)
    VALUES (coalesce(p_date, current_date), v_emp, v_half, v_start, v_end, round(v_mins / 60.0, 2),
            nullif(trim(p_note), ''), v_photos, auth.uid(),
            CASE WHEN v_is_hari THEN auth.uid() END, CASE WHEN v_is_hari THEN now() END);

    SELECT full_name INTO v_name FROM profiles WHERE id = v_emp;
    v_lines := v_lines || E'\n• ' || coalesce(v_name, '?') || ' — ' || v_when || ' (' ||
               (v_mins / 60) || 'h ' || lpad((v_mins % 60)::text, 2, '0') || 'm)';
    v_count := v_count + 1;
  END LOOP;

  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();
  IF v_is_hari THEN
    SELECT id INTO v_anu FROM profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
    IF v_anu IS NOT NULL AND v_anu <> auth.uid() THEN
      INSERT INTO notifications (user_id, title, body, type)
      VALUES (v_anu, 'Overtime entered — ' || to_char(coalesce(p_date, current_date), 'DD Mon YYYY'),
        coalesce(v_me, 'Hari') || ' entered overtime for ' || v_count || ' ' ||
          CASE WHEN v_count = 1 THEN 'person' ELSE 'people' END ||
          coalesce(' (' || nullif(trim(p_note), '') || ')', '') || ':' || v_lines || v_photo_txt, 'overtime');
    END IF;
  ELSE
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_hari, 'Overtime waiting for your approval — ' || to_char(coalesce(p_date, current_date), 'DD Mon YYYY'),
      coalesce(v_me, 'A manager') || ' entered overtime for ' || v_count || ' ' ||
        CASE WHEN v_count = 1 THEN 'person' ELSE 'people' END ||
        coalesce(' (' || nullif(trim(p_note), '') || ')', '') || ':' || v_lines || v_photo_txt, 'overtime');
  END IF;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_overtime_entries(date, jsonb, text, text[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.add_overtime_entries(date, jsonb, text, text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
