-- 1) Payments from production@triloautomation.com: Hari approves (verifies) first, then the admins
CREATE OR REPLACE FUNCTION public._payment_route_production()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hari uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = NEW.requester_id AND lower(email) = 'production@triloautomation.com') THEN
    SELECT id INTO v_hari FROM profiles WHERE lower(email) = 'hari@triloautomation.com' LIMIT 1;
    IF v_hari IS NOT NULL AND v_hari <> NEW.requester_id THEN
      NEW.verifier_id := v_hari;
      NEW.status := 'pending_verification';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payment_route_production ON public.payment_requests;
CREATE TRIGGER trg_payment_route_production BEFORE INSERT ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public._payment_route_production();

-- 2) Overtime: entries by anyone other than Hari wait for Hari's approval; after he approves, Anu is told.
--    Hari's own entries go straight to Anu.
CREATE OR REPLACE FUNCTION public.add_overtime_entries(p_date date, p_entries jsonb, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e jsonb; v_emp uuid; v_half text; v_start time; v_end time; v_mins integer;
  v_me text; v_anu uuid; v_hari uuid; v_is_hari boolean; v_lines text := ''; v_count integer := 0; v_name text; v_when text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'Only managers and admins can enter overtime';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'Select at least one name';
  END IF;
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
                                  created_by, verified_by, verified_at)
    VALUES (coalesce(p_date, current_date), v_emp, v_half, v_start, v_end, round(v_mins / 60.0, 2),
            nullif(trim(p_note), ''), auth.uid(),
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
          coalesce(' (' || nullif(trim(p_note), '') || ')', '') || ':' || v_lines, 'overtime');
    END IF;
  ELSE
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_hari, 'Overtime waiting for your approval — ' || to_char(coalesce(p_date, current_date), 'DD Mon YYYY'),
      coalesce(v_me, 'A manager') || ' entered overtime for ' || v_count || ' ' ||
        CASE WHEN v_count = 1 THEN 'person' ELSE 'people' END ||
        coalesce(' (' || nullif(trim(p_note), '') || ')', '') || ':' || v_lines, 'overtime');
  END IF;
  RETURN v_count;
END;
$$;

-- Hari approves → Anu gets one message listing the approved entries
CREATE OR REPLACE FUNCTION public.verify_overtime(p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me text; v_anu uuid; v_lines text; v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND lower(email) = 'hari@triloautomation.com') THEN
    RAISE EXCEPTION 'Only Hari can approve overtime';
  END IF;

  WITH upd AS (
    UPDATE overtime_entries SET verified_by = auth.uid(), verified_at = now()
     WHERE id = ANY(p_ids) AND verified_at IS NULL
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
NOTIFY pgrst, 'reload schema';
