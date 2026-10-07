-- Managers (and admins) enter overtime for the admin's OT members.
-- Each entry is sent to anu@triloautomation.com straight away.
DROP POLICY IF EXISTS ot_admin_insert ON public.overtime_entries;   -- entries now go through add_overtime()

CREATE OR REPLACE FUNCTION public.add_overtime(
  p_date date, p_employee_ids uuid[], p_half text, p_hours numeric, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    text;
  v_anu   uuid;
  v_lines text;
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'Only managers and admins can enter overtime';
  END IF;
  IF p_half NOT IN ('first','second') THEN RAISE EXCEPTION 'Choose First half or Second half'; END IF;
  IF p_hours IS NULL OR p_hours <= 0 OR p_hours > 24 THEN RAISE EXCEPTION 'Enter the OT duration in hours'; END IF;
  IF coalesce(array_length(p_employee_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Select at least one name'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_employee_ids) e(id)
             WHERE NOT EXISTS (SELECT 1 FROM overtime_members m WHERE m.employee_id = e.id)) THEN
    RAISE EXCEPTION 'Only people on the OT members list can be selected';
  END IF;

  WITH ins AS (
    INSERT INTO overtime_entries (work_date, employee_id, half, duration_hours, note, created_by, verified_by, verified_at)
    SELECT coalesce(p_date, current_date), e.id, p_half, p_hours, nullif(trim(p_note), ''), auth.uid(), auth.uid(), now()
      FROM (SELECT DISTINCT unnest(p_employee_ids) AS id) e
    RETURNING employee_id
  )
  SELECT count(*), string_agg(coalesce(p.full_name, '?'), ', ' ORDER BY p.full_name)
    INTO v_count, v_lines
    FROM ins i LEFT JOIN profiles p ON p.id = i.employee_id;

  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();
  SELECT id INTO v_anu FROM profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
  IF v_anu IS NOT NULL AND v_anu <> auth.uid() THEN
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_anu,
      'Overtime entered — ' || to_char(coalesce(p_date, current_date), 'DD Mon YYYY'),
      coalesce(v_me, 'A manager') || ' entered overtime (' ||
        CASE p_half WHEN 'first' THEN 'First half' ELSE 'Second half' END || ', ' ||
        trim(trailing '.' FROM trim(trailing '0' FROM p_hours::text)) || ' h' ||
        coalesce(', ' || nullif(trim(p_note), ''), '') || ') for ' || v_count || ' ' ||
        CASE WHEN v_count = 1 THEN 'person' ELSE 'people' END || ': ' || v_lines,
      'overtime');
  END IF;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_overtime(date, uuid[], text, numeric, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.add_overtime(date, uuid[], text, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
