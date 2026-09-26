-- ═══════════════════════════════════════════════════════════════════════════
--  Company (Trilo / Mapl) + employee names for attendance
--  Run in Supabase > SQL Editor (project jhtfhjfwjsutkwebmrgv). Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.employees  ADD COLUMN IF NOT EXISTS company text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS company text;

-- Company for a machine ID: from employees table, else by rule
-- (H.. or 3-digit IDs = Trilo, anything else = Mapl)
CREATE OR REPLACE FUNCTION public.company_for(p_emp text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT company FROM employees WHERE employee_id = p_emp),
    CASE WHEN p_emp ~* '^H' OR length(p_emp) = 3 THEN 'Trilo' ELSE 'Mapl' END);
$$;

-- 1. Names and companies
INSERT INTO public.employees (employee_id, employee_name, company) VALUES
  ('H01','Sagar','Trilo'), ('H02','Balvir','Trilo'), ('H03','Sathya Narayanan','Trilo'),
  ('H04','Subam','Trilo'), ('H05','Ranjan','Trilo'), ('H06','Sonu','Trilo'),
  ('H07','Subhkaran','Trilo'), ('H08','Kutty Ammal','Trilo'), ('H09','Cleaner','Trilo'),
  ('H10','Sakir Husain','Trilo'), ('H11','Kaif Raja','Trilo'),
  ('001','Saravanan','Trilo'), ('002','Ashish','Trilo'), ('003','Jaisoorya M','Trilo'),
  ('004','Harish Kanna','Trilo'), ('005','Thiyanesh','Trilo'), ('006','Mohan','Trilo'),
  ('009','Senthil','Trilo'), ('010','Guna','Trilo'), ('011','Anu','Trilo'),
  ('013','Guru','Trilo'), ('014','Inbanidhi','Trilo'), ('015','Deepak Gen','Trilo'),
  ('016','Ragul','Trilo'), ('017','Aiswarya','Trilo'), ('018','Mageshwaran','Trilo'),
  ('17','Surya Barani','Mapl'), ('19','Jagadesh','Mapl'), ('23','Lingesh','Mapl'),
  ('35','Naveen','Mapl'), ('37','Puspakanth','Mapl')
ON CONFLICT (employee_id) DO UPDATE
  SET employee_name = EXCLUDED.employee_name, company = EXCLUDED.company;

-- 2. Daily rebuild now also stores company
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

  INSERT INTO attendance (employee_id, user_id, employee_name, company, work_date, punch_in, punch_out, total_hours, punch_count)
  VALUES (
    p_emp, v_uid, v_name, company_for(p_emp), p_date,
    (v_in AT TIME ZONE 'Asia/Kolkata')::time(0),
    CASE WHEN v_out - v_in > interval '5 minutes' THEN (v_out AT TIME ZONE 'Asia/Kolkata')::time(0) END,
    CASE WHEN v_out - v_in > interval '5 minutes' THEN round(extract(epoch FROM v_out - v_in) / 3600.0, 2) END,
    v_cnt
  )
  ON CONFLICT (employee_id, work_date) DO UPDATE SET
    user_id = EXCLUDED.user_id, employee_name = EXCLUDED.employee_name, company = EXCLUDED.company,
    punch_in = EXCLUDED.punch_in, punch_out = EXCLUDED.punch_out,
    total_hours = EXCLUDED.total_hours, punch_count = EXCLUDED.punch_count;
END $$;

-- 3. Name/company changed in employees -> update that person's attendance rows
CREATE OR REPLACE FUNCTION public.trg_employee_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE attendance SET company = coalesce(NEW.company, company)
  WHERE employee_id = NEW.employee_id;
  UPDATE attendance SET employee_name = NEW.employee_name
  WHERE employee_id = NEW.employee_id AND user_id IS NULL;
  RETURN NULL;
END $$;

-- 4. Fill existing rows
UPDATE public.attendance a SET
  company = public.company_for(a.employee_id),
  employee_name = coalesce(
    (SELECT full_name FROM public.profiles p WHERE p.id = a.user_id),
    (SELECT employee_name FROM public.employees e WHERE e.employee_id = a.employee_id),
    a.employee_name);

-- 5. Summary views with company
DROP VIEW IF EXISTS public.daily_summary;
CREATE VIEW public.daily_summary WITH (security_invoker = true) AS
SELECT
  work_date, company,
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
GROUP BY work_date, company;

DROP VIEW IF EXISTS public.weekly_attendance;
CREATE VIEW public.weekly_attendance WITH (security_invoker = true) AS
SELECT
  employee_id, max(employee_name) AS employee_name, max(company) AS company,
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

DROP VIEW IF EXISTS public.monthly_attendance;
CREATE VIEW public.monthly_attendance WITH (security_invoker = true) AS
SELECT
  employee_id, max(employee_name) AS employee_name, max(company) AS company,
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

GRANT SELECT ON public.daily_summary, public.weekly_attendance, public.monthly_attendance TO authenticated;
