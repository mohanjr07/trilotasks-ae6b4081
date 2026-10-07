-- People dedicated to overtime — admins keep this list; only they can be picked for an OT entry
CREATE TABLE IF NOT EXISTS public.overtime_members (
  employee_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by    uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  added_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.overtime_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS otm_read ON public.overtime_members;
CREATE POLICY otm_read ON public.overtime_members FOR SELECT TO authenticated
  USING (public.can_see_overtime(auth.uid()));
DROP POLICY IF EXISTS otm_admin_insert ON public.overtime_members;
CREATE POLICY otm_admin_insert ON public.overtime_members FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS otm_admin_delete ON public.overtime_members;
CREATE POLICY otm_admin_delete ON public.overtime_members FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- OT entries can only be added for people on the list
DROP POLICY IF EXISTS ot_admin_insert ON public.overtime_entries;
CREATE POLICY ot_admin_insert ON public.overtime_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid()) AND created_by = auth.uid() AND verified_at IS NULL AND verified_by IS NULL
    AND EXISTS (SELECT 1 FROM public.overtime_members m WHERE m.employee_id = overtime_entries.employee_id)
  );

NOTIFY pgrst, 'reload schema';
