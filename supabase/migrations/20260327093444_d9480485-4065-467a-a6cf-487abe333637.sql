CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  date date NOT NULL,
  type text NOT NULL DEFAULT 'government' CHECK (type IN ('government', 'company', 'optional')),
  description text,
  is_recurring boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read holidays" ON public.holidays
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage holidays" ON public.holidays
  FOR ALL TO authenticated USING (is_admin(auth.uid()));