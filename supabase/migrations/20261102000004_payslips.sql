-- ─────────────────────────────────────────────────────────────────────────────
--  Payslips
--  • anu@triloautomation.com creates and edits payslips.
--  • Admins see every payslip; everyone else sees and downloads only their own.
--  • Employee ID (new) and Position live on the profile; Date of Joining = profiles.joined_at.
--  • PAN / Account number / IFSC are kept per employee in payroll_details
--    (only the employee, Anu and admins can read them; only Anu edits them).
--  • Each payslip keeps a copy of those details, so old slips never change.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_code text;

CREATE OR REPLACE FUNCTION public.is_payroll_editor(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND lower(email) IN ('anu@triloautomation.com'))
$$;
CREATE OR REPLACE FUNCTION public.is_payroll_viewer(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_payroll_editor(uid) OR EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND role IN ('admin','super_admin'))
$$;
REVOKE EXECUTE ON FUNCTION public.is_payroll_editor(uuid), public.is_payroll_viewer(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_payroll_editor(uuid), public.is_payroll_viewer(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.payroll_details (
  user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pan_number     text,
  account_number text,
  ifsc_code      text,
  updated_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_details_read ON public.payroll_details;
CREATE POLICY payroll_details_read ON public.payroll_details FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_payroll_viewer(auth.uid()));
DROP POLICY IF EXISTS payroll_details_write ON public.payroll_details;
CREATE POLICY payroll_details_write ON public.payroll_details FOR ALL TO authenticated
  USING (public.is_payroll_editor(auth.uid())) WITH CHECK (public.is_payroll_editor(auth.uid()));
REVOKE ALL ON public.payroll_details FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_details TO authenticated;

CREATE TABLE IF NOT EXISTS public.payslips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pay_month        date NOT NULL,                 -- first day of the month the salary is for
  pay_date         date,                          -- "Pay Period" printed on the slip
  employee_name    text NOT NULL,
  employee_code    text,
  position         text,
  date_of_joining  date,
  pan_number       text,
  account_number   text,
  ifsc_code        text,
  earnings         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ "label": "Basic Pay", "amount": 40700 }, …]
  deductions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_earnings   numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  net_pay          numeric NOT NULL DEFAULT 0,
  created_by       uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pay_month)
);
CREATE INDEX IF NOT EXISTS payslips_month_idx ON public.payslips (pay_month DESC);
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payslips_read ON public.payslips;
CREATE POLICY payslips_read ON public.payslips FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_payroll_viewer(auth.uid()));
DROP POLICY IF EXISTS payslips_write ON public.payslips;
CREATE POLICY payslips_write ON public.payslips FOR ALL TO authenticated
  USING (public.is_payroll_editor(auth.uid())) WITH CHECK (public.is_payroll_editor(auth.uid()));
REVOKE ALL ON public.payslips FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payslips TO authenticated;

-- totals are always worked out by the database
CREATE OR REPLACE FUNCTION public._payslip_totals()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.total_earnings := coalesce((SELECT sum(coalesce(nullif(e->>'amount','')::numeric, 0)) FROM jsonb_array_elements(NEW.earnings) e), 0);
  NEW.total_deductions := coalesce((SELECT sum(coalesce(nullif(e->>'amount','')::numeric, 0)) FROM jsonb_array_elements(NEW.deductions) e), 0);
  NEW.net_pay := NEW.total_earnings - NEW.total_deductions;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payslip_totals ON public.payslips;
CREATE TRIGGER trg_payslip_totals BEFORE INSERT OR UPDATE ON public.payslips FOR EACH ROW EXECUTE FUNCTION public._payslip_totals();

-- tell the employee when their payslip is ready / updated
CREATE OR REPLACE FUNCTION public._payslip_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, body, type, reference_id)
  VALUES (NEW.user_id,
          CASE WHEN TG_OP = 'INSERT' THEN 'Payslip ready' ELSE 'Payslip updated' END,
          'Your payslip for ' || to_char(NEW.pay_month, 'FMMonth YYYY') || ' is ready to view and download.', 'system', NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payslip_notify ON public.payslips;
CREATE TRIGGER trg_payslip_notify AFTER INSERT ON public.payslips FOR EACH ROW EXECUTE FUNCTION public._payslip_notify();

-- Anu: save Employee ID / Position / Date of Joining on the profile
CREATE OR REPLACE FUNCTION public.set_payroll_profile(p_user uuid, p_employee_code text, p_position text, p_joined date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_payroll_editor(auth.uid()) THEN RAISE EXCEPTION 'Only Anu can edit payroll details'; END IF;
  UPDATE public.profiles SET employee_code = nullif(trim(coalesce(p_employee_code, '')), ''),
         position = coalesce(nullif(trim(coalesce(p_position, '')), ''), position),
         joined_at = coalesce(p_joined, joined_at)
   WHERE id = p_user;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_payroll_profile(uuid, text, text, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_payroll_profile(uuid, text, text, date) TO authenticated;

-- everyone's payroll profile (name, ID, position, joining) for Anu / admins
CREATE OR REPLACE FUNCTION public.payroll_people()
RETURNS TABLE (id uuid, full_name text, employee_code text, "position" text, joined_at date, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.employee_code, p.position, p.joined_at::date, coalesce(p.is_active, true)
    FROM public.profiles p
   WHERE public.is_payroll_viewer(auth.uid()) OR p.id = auth.uid()
   ORDER BY p.full_name
$$;
REVOKE EXECUTE ON FUNCTION public.payroll_people() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.payroll_people() TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'payslips') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payslips;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
