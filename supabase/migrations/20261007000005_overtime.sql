-- ═══════════════════════════════════════════════════════════════════════
--  Overtime: admins add entries (many people at once) → a manager/admin
--  verifies → anu@triloautomation.com is notified.
--  Visible only to admins, managers and anu@triloautomation.com.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Allow an 'overtime' notification type (keeps every type already in use)
DO $$
DECLARE v_types text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(t), ',') INTO v_types
  FROM (SELECT type AS t FROM public.notifications WHERE type IS NOT NULL
        UNION SELECT unnest(ARRAY['task','leave','system','payment','form','overtime'])) x;
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE 'ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (' || v_types || '))';
END $$;

-- 2. Who may use the page
CREATE OR REPLACE FUNCTION public.can_see_overtime(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid
      AND (role IN ('admin','super_admin','manager') OR lower(email) = 'anu@triloautomation.com')
  )
$$;

-- 3. Entries
CREATE TABLE IF NOT EXISTS public.overtime_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date      date NOT NULL DEFAULT current_date,
  employee_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  half           text NOT NULL CHECK (half IN ('first','second')),
  duration_hours numeric(4,2) NOT NULL CHECK (duration_hours > 0 AND duration_hours <= 24),
  note           text,
  created_by     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  verified_by    uuid REFERENCES public.profiles(id),
  verified_at    timestamptz
);
CREATE INDEX IF NOT EXISTS overtime_entries_date_idx ON public.overtime_entries (work_date DESC);
ALTER TABLE public.overtime_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ot_read ON public.overtime_entries;
CREATE POLICY ot_read ON public.overtime_entries FOR SELECT TO authenticated
  USING (public.can_see_overtime(auth.uid()));

DROP POLICY IF EXISTS ot_admin_insert ON public.overtime_entries;
CREATE POLICY ot_admin_insert ON public.overtime_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) AND created_by = auth.uid() AND verified_at IS NULL AND verified_by IS NULL);

DROP POLICY IF EXISTS ot_admin_update_unverified ON public.overtime_entries;
CREATE POLICY ot_admin_update_unverified ON public.overtime_entries FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) AND verified_at IS NULL)
  WITH CHECK (public.is_admin(auth.uid()) AND verified_at IS NULL);

DROP POLICY IF EXISTS ot_admin_delete ON public.overtime_entries;
CREATE POLICY ot_admin_delete ON public.overtime_entries FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- 4. Verify (managers + admins) → one notification to Anu listing the entries
CREATE OR REPLACE FUNCTION public.verify_overtime(p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    text;
  v_anu   uuid;
  v_lines text;
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'Only managers and admins can verify overtime';
  END IF;

  WITH upd AS (
    UPDATE overtime_entries SET verified_by = auth.uid(), verified_at = now()
     WHERE id = ANY(p_ids) AND verified_at IS NULL
    RETURNING employee_id, work_date, half, duration_hours
  )
  SELECT count(*),
         string_agg(coalesce(p.full_name, '?') || ' — ' || to_char(u.work_date, 'DD Mon') || ', ' ||
                    CASE u.half WHEN 'first' THEN 'First half' ELSE 'Second half' END || ', ' ||
                    trim(trailing '.' FROM trim(trailing '0' FROM u.duration_hours::text)) || ' h',
                    E'\n' ORDER BY u.work_date, p.full_name)
    INTO v_count, v_lines
    FROM upd u LEFT JOIN profiles p ON p.id = u.employee_id;

  IF v_count = 0 THEN RETURN 0; END IF;

  SELECT full_name INTO v_me FROM profiles WHERE id = auth.uid();
  SELECT id INTO v_anu FROM profiles WHERE lower(email) = 'anu@triloautomation.com' LIMIT 1;
  IF v_anu IS NOT NULL AND v_anu <> auth.uid() THEN
    INSERT INTO notifications (user_id, title, body, type)
    VALUES (v_anu, 'Overtime verified (' || v_count || ' ' || CASE WHEN v_count = 1 THEN 'entry' ELSE 'entries' END || ')',
            'Verified by ' || coalesce(v_me, 'a manager') || E':\n' || v_lines, 'overtime');
  END IF;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_overtime(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_overtime(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_see_overtime(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_see_overtime(uuid) TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.overtime_entries;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
