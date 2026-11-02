-- Project forms timeline: Order Booking → Pre Design → Design → Post Design → Production → Dispatch.
-- Each form template (Forms and Formats) can sit in one stage. Admins add / remove them.
CREATE TABLE IF NOT EXISTS public.form_stage_map (
  form_id    uuid PRIMARY KEY REFERENCES public.production_forms(id) ON DELETE CASCADE,
  stage      text NOT NULL CHECK (stage IN ('order_booking','pre_design','design','post_design','production','dispatch')),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.form_stage_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fsm_read ON public.form_stage_map;
CREATE POLICY fsm_read ON public.form_stage_map FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS fsm_admin_write ON public.form_stage_map;
CREATE POLICY fsm_admin_write ON public.form_stage_map FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin')));
REVOKE ALL ON public.form_stage_map FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_stage_map TO authenticated;

-- the fixed timeline
INSERT INTO public.form_stage_map (form_id, stage)
SELECT id, CASE
    WHEN title ~* '^\s*production\s*form' THEN 'production'
    WHEN title ~* 'dispatch' THEN 'dispatch'
    WHEN title ~* 'material\s*request' THEN 'post_design'
    WHEN title ~* 'quality\s*check\s*drawing' THEN 'design'
    WHEN title ~* 'design\s*validation' THEN 'pre_design'
  END
  FROM public.production_forms
 WHERE title ~* '^\s*production\s*form|dispatch|material\s*request|quality\s*check\s*drawing|design\s*validation'
ON CONFLICT (form_id) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'form_stage_map') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.form_stage_map;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
