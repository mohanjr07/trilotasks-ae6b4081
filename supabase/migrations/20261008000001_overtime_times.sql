-- Overtime: start / end time per person; hours are worked out from them
ALTER TABLE public.overtime_entries
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time   time;

CREATE OR REPLACE FUNCTION public.add_overtime_entries(p_date date, p_entries jsonb, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e       jsonb;
  v_emp   uuid;
  v_half  text;
  v_start time;
  v_end   time;
  v_mins  integer;
  v_me    text;
  v_anu   uuid;
  v_lines text := '';
  v_count integer := 0;
  v_name  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'Only managers and admins can enter overtime';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'Select at least one name';
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_emp   := (e->>'employee_id')::uuid;
    v_half  := e->>'half';
    v_start := (e->>'start_time')::time;
    v_end   := (e->>'end_time')::time;
    IF NOT EXISTS (SELECT 1 FROM overtime_members m WHERE m.employee_id = v_emp) THEN
      RAISE EXCEPTION 'Only people on the OT members list can be selected';
    END IF;
    IF v_half NOT IN ('first','second') THEN RAISE EXCEPTION 'Choose First half or Second half'; END IF;
    IF v_start IS NULL OR v_end IS NULL THEN RAISE EXCEPTION 'Enter the start and end time'; END IF;
    v_mins := (extract(epoch FROM (v_end - v_start)) / 60)::int;
    IF v_mins <= 0 THEN v_mins := v_mins + 1440; END IF;          -- ran past midnight
    IF v_mins > 960 THEN RAISE EXCEPTION 'Overtime of more than 16 hours — please check the times'; END IF;

    INSERT INTO overtime_entries (work_date, employee_id, half, start_time, end_time, duration_hours, note,
                                  created_by, verified_by, verified_at)
    VALUES (coalesce(p_date, current_date), v_emp, v_half, v_start, v_end, round(v_mins / 60.0, 2),
            nullif(trim(p_note), ''), auth.uid(), auth.uid(), now());

    SELECT full_name INTO v_name FROM profiles WHERE id = v_emp;
    v_lines := v_lines || E'\n• ' || coalesce(v_name, '?') || ' — ' ||
               CASE v_half WHEN 'first' THEN 'First half' ELSE 'Second half' END || ', ' ||
               to_char(v_start, 'HH12:MI AM') || ' to ' || to_char(v_end, 'HH12:MI AM') || ' (' ||
               (v_mins / 60) || 'h ' || lpad((v_mins % 60)::text, 2, '0') || 'm)';
    v_count := v_count + 1;
  END LOOP;

  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();
  SELECT id INTO v_anu FROM profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
  IF v_anu IS NOT NULL AND v_anu <> auth.uid() THEN
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_anu,
      'Overtime entered — ' || to_char(coalesce(p_date, current_date), 'DD Mon YYYY'),
      coalesce(v_me, 'A manager') || ' entered overtime for ' || v_count || ' ' ||
        CASE WHEN v_count = 1 THEN 'person' ELSE 'people' END ||
        coalesce(' (' || nullif(trim(p_note), '') || ')', '') || ':' || v_lines,
      'overtime');
  END IF;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_overtime_entries(date, jsonb, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.add_overtime_entries(date, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
