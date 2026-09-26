-- ═══════════════════════════════════════════════════════════════════════════
--  Attendance (eSSL biometric) for Trilo Task Flow
--  Run in the TASK FLOW Supabase project > SQL Editor. Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0. Link a Task Flow user to their ID on the eSSL machine (e.g. '006')
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS biometric_code text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_biometric_code_key
  ON public.profiles (biometric_code) WHERE biometric_code IS NOT NULL;

-- Helper: admins / managers can see everyone's attendance
CREATE OR REPLACE FUNCTION public.is_attendance_admin(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = uid AND role IN ('admin','manager','super_admin')
  );
$$;

-- 1. Raw punches from the machine (written by the Cloudflare receiver)
CREATE TABLE IF NOT EXISTS public.punch_logs (
  id             bigserial PRIMARY KEY,
  biometric_code text        NOT NULL,
  punch_time     timestamptz NOT NULL,
  device_id      text,
  direction      text,
  source         text        NOT NULL DEFAULT 'adms',
  synced_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (biometric_code, punch_time)
);
CREATE INDEX IF NOT EXISTS punch_logs_time_idx ON public.punch_logs (punch_time);
ALTER TABLE public.punch_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS punch_logs_admin_read ON public.punch_logs;
CREATE POLICY punch_logs_admin_read ON public.punch_logs
  FOR SELECT TO authenticated USING (public.is_attendance_admin(auth.uid()));

-- 2. Names stored on the machine (fallback when no Task Flow user is linked)
CREATE TABLE IF NOT EXISTS public.employees (
  employee_id   text PRIMARY KEY,
  employee_name text NOT NULL
);
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employees_admin_read ON public.employees;
CREATE POLICY employees_admin_read ON public.employees
  FOR SELECT TO authenticated USING (public.is_attendance_admin(auth.uid()));

-- 3. One row per employee per day
CREATE TABLE IF NOT EXISTS public.attendance (
  employee_id   text NOT NULL,              -- machine ID
  user_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_name text,
  work_date     date NOT NULL,
  punch_in      time,
  punch_out     time,
  total_hours   numeric(5,2),
  punch_count   int,
  PRIMARY KEY (employee_id, work_date)
);
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS attendance_date_idx ON public.attendance (work_date);
CREATE INDEX IF NOT EXISTS attendance_user_idx ON public.attendance (user_id);
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_read ON public.attendance;
CREATE POLICY attendance_read ON public.attendance
  FOR SELECT TO authenticated
  USING (public.is_attendance_admin(auth.uid()) OR user_id = auth.uid());

-- 4. Rebuild one person's day from the raw punches
--    first punch = IN, last punch = OUT; a 2nd punch within 5 min = accidental double punch
CREATE OR REPLACE FUNCTION public.refresh_attendance(p_emp text, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_in timestamptz; v_out timestamptz; v_cnt int; v_uid uuid; v_name text;
BEGIN
  SELECT min(punch_time), max(punch_time), count(*) INTO v_in, v_out, v_cnt
  FROM punch_logs
  WHERE biometric_code = p_emp
    AND (punch_time AT TIME ZONE 'Asia/Kolkata')::date = p_date;

  IF v_cnt = 0 THEN
    DELETE FROM attendance WHERE employee_id = p_emp AND work_date = p_date;
    RETURN;
  END IF;

  SELECT id, full_name INTO v_uid, v_name FROM profiles WHERE biometric_code = p_emp LIMIT 1;
  IF v_name IS NULL THEN
    SELECT employee_name INTO v_name FROM employees WHERE employee_id = p_emp;
  END IF;

  INSERT INTO attendance (employee_id, user_id, employee_name, work_date, punch_in, punch_out, total_hours, punch_count)
  VALUES (
    p_emp, v_uid, v_name, p_date,
    (v_in AT TIME ZONE 'Asia/Kolkata')::time(0),
    CASE WHEN v_out - v_in > interval '5 minutes' THEN (v_out AT TIME ZONE 'Asia/Kolkata')::time(0) END,
    CASE WHEN v_out - v_in > interval '5 minutes' THEN round(extract(epoch FROM v_out - v_in) / 3600.0, 2) END,
    v_cnt
  )
  ON CONFLICT (employee_id, work_date) DO UPDATE SET
    user_id = EXCLUDED.user_id, employee_name = EXCLUDED.employee_name,
    punch_in = EXCLUDED.punch_in, punch_out = EXCLUDED.punch_out,
    total_hours = EXCLUDED.total_hours, punch_count = EXCLUDED.punch_count;
END $$;

-- 5. Every punch updates that person's day
CREATE OR REPLACE FUNCTION public.trg_punch_to_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    PERFORM refresh_attendance(OLD.biometric_code, (OLD.punch_time AT TIME ZONE 'Asia/Kolkata')::date);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM refresh_attendance(NEW.biometric_code, (NEW.punch_time AT TIME ZONE 'Asia/Kolkata')::date);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS punch_to_attendance ON public.punch_logs;
CREATE TRIGGER punch_to_attendance AFTER INSERT OR UPDATE OR DELETE ON public.punch_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_punch_to_attendance();

-- 6. Machine name added/changed -> update rows that aren't linked to a Task Flow user
CREATE OR REPLACE FUNCTION public.trg_employee_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE attendance SET employee_name = NEW.employee_name
  WHERE employee_id = NEW.employee_id AND user_id IS NULL;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS employee_name_sync ON public.employees;
CREATE TRIGGER employee_name_sync AFTER INSERT OR UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.trg_employee_name();

-- 7. Machine ID linked/changed on a profile -> relink that person's attendance
CREATE OR REPLACE FUNCTION public.trg_profile_biometric()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.biometric_code IS NOT NULL
     AND OLD.biometric_code IS DISTINCT FROM NEW.biometric_code THEN
    UPDATE attendance SET user_id = NULL,
      employee_name = (SELECT employee_name FROM employees WHERE employee_id = OLD.biometric_code)
    WHERE employee_id = OLD.biometric_code;
  END IF;
  IF NEW.biometric_code IS NOT NULL THEN
    UPDATE attendance SET user_id = NEW.id, employee_name = NEW.full_name
    WHERE employee_id = NEW.biometric_code;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS profile_biometric_sync ON public.profiles;
CREATE TRIGGER profile_biometric_sync AFTER INSERT OR UPDATE OF biometric_code, full_name ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trg_profile_biometric();

-- 8. Summary views (security_invoker = the same row rules as attendance)
CREATE OR REPLACE VIEW public.daily_summary WITH (security_invoker = true) AS
SELECT
  work_date,
  to_char(work_date, 'Dy')                                   AS day,
  count(*)                                                   AS employees_present,
  count(*) FILTER (WHERE punch_out IS NULL)                  AS missing_punch_out,
  coalesce(sum(total_hours), 0)                              AS total_hours,
  round(avg(total_hours), 2)                                 AS avg_hours_per_person,
  min(punch_in)                                              AS first_arrival,
  max(punch_in)                                              AS last_arrival,
  max(punch_out)                                             AS last_departure,
  string_agg(coalesce(employee_name, employee_id), ', ' ORDER BY employee_id) AS who_was_present
FROM public.attendance
GROUP BY work_date;

CREATE OR REPLACE VIEW public.weekly_attendance WITH (security_invoker = true) AS
SELECT
  employee_id,
  max(employee_name)                                         AS employee_name,
  date_trunc('week', work_date)::date                        AS week_start,
  (date_trunc('week', work_date) + interval '6 days')::date  AS week_end,
  count(*)                                                   AS days_present,
  count(*) FILTER (WHERE punch_out IS NULL)                  AS missing_punch_out,
  coalesce(sum(total_hours), 0)                              AS total_hours,
  round(avg(total_hours), 2)                                 AS avg_hours_per_day,
  min(punch_in)                                              AS earliest_in,
  max(punch_in)                                              AS latest_in
FROM public.attendance
GROUP BY employee_id, date_trunc('week', work_date);

CREATE OR REPLACE VIEW public.monthly_attendance WITH (security_invoker = true) AS
SELECT
  employee_id,
  max(employee_name)                                         AS employee_name,
  to_char(date_trunc('month', work_date), 'YYYY-MM')         AS month,
  to_char(date_trunc('month', work_date), 'Mon YYYY')        AS month_name,
  count(*)                                                   AS days_present,
  count(*) FILTER (WHERE punch_out IS NULL)                  AS missing_punch_out,
  coalesce(sum(total_hours), 0)                              AS total_hours,
  round(avg(total_hours), 2)                                 AS avg_hours_per_day,
  min(punch_in)                                              AS earliest_in,
  max(punch_in)                                              AS latest_in
FROM public.attendance
GROUP BY employee_id, date_trunc('month', work_date);

GRANT SELECT ON public.attendance, public.punch_logs, public.employees,
                public.daily_summary, public.weekly_attendance, public.monthly_attendance
TO authenticated;
