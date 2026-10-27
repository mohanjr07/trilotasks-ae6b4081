-- Overtime: Hari can reject entries (with a reason) as well as approve them.
-- Rejected entries are not sent to Anu; whoever entered them is told why.
ALTER TABLE public.overtime_entries ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.overtime_entries ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.overtime_entries ADD COLUMN IF NOT EXISTS reject_reason text;

-- approve: never touches rejected entries
CREATE OR REPLACE FUNCTION public.verify_overtime(p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me text; v_anu uuid; v_lines text; v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND lower(email) = 'hari@triloautomation.com') THEN
    RAISE EXCEPTION 'Only Hari can approve overtime';
  END IF;

  WITH upd AS (
    UPDATE overtime_entries SET verified_by = auth.uid(), verified_at = now()
     WHERE id = ANY(p_ids) AND verified_at IS NULL AND rejected_at IS NULL
    RETURNING employee_id, work_date, half, start_time, end_time, duration_hours
  )
  SELECT count(*),
         string_agg('• ' || coalesce(p.full_name, '?') || ' — ' || to_char(u.work_date, 'DD Mon') || ', ' ||
                    CASE WHEN u.half = 'full' THEN 'Full day'
                         WHEN u.start_time IS NOT NULL THEN to_char(u.start_time, 'HH12:MI AM') || ' to ' || to_char(u.end_time, 'HH12:MI AM')
                         ELSE initcap(u.half) || ' half' END || ' (' ||
                    trim(trailing '.' FROM trim(trailing '0' FROM u.duration_hours::text)) || ' h)',
                    E'\n' ORDER BY u.work_date, p.full_name)
    INTO v_count, v_lines
    FROM upd u LEFT JOIN profiles p ON p.id = u.employee_id;

  IF v_count = 0 THEN RETURN 0; END IF;
  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();
  SELECT id INTO v_anu FROM profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
  IF v_anu IS NOT NULL AND v_anu <> auth.uid() THEN
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_anu, 'Overtime approved by ' || coalesce(v_me, 'Hari') || ' (' || v_count || ' ' ||
                   CASE WHEN v_count = 1 THEN 'entry' ELSE 'entries' END || ')',
            v_lines, 'overtime');
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_overtime(p_ids uuid[], p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me text; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_count integer := 0; r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND lower(email) = 'hari@triloautomation.com') THEN
    RAISE EXCEPTION 'Only Hari can reject overtime';
  END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Give a reason for rejecting'; END IF;
  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();

  -- one notification per person who entered the overtime
  FOR r IN
    WITH upd AS (
      UPDATE overtime_entries SET rejected_by = auth.uid(), rejected_at = now(), reject_reason = v_reason
       WHERE id = ANY(p_ids) AND verified_at IS NULL AND rejected_at IS NULL
      RETURNING created_by, employee_id, work_date, duration_hours
    )
    SELECT u.created_by, count(*) AS n,
           string_agg('• ' || coalesce(p.full_name, '?') || ' — ' || to_char(u.work_date, 'DD Mon') || ' (' ||
                      trim(trailing '.' FROM trim(trailing '0' FROM u.duration_hours::text)) || ' h)', E'\n' ORDER BY u.work_date, p.full_name) AS lines
      FROM upd u LEFT JOIN profiles p ON p.id = u.employee_id
     GROUP BY u.created_by
  LOOP
    v_count := v_count + r.n;
    IF r.created_by IS NOT NULL AND r.created_by <> auth.uid() THEN
      INSERT INTO notifications (user_id, title, body, type)
      VALUES (r.created_by, 'Overtime rejected by ' || coalesce(v_me, 'Hari') || ' (' || r.n || ' ' || CASE WHEN r.n = 1 THEN 'entry' ELSE 'entries' END || ')',
              'Reason: ' || v_reason || E'\n' || r.lines, 'overtime');
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reject_overtime(uuid[], text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reject_overtime(uuid[], text) TO authenticated;

NOTIFY pgrst, 'reload schema';
