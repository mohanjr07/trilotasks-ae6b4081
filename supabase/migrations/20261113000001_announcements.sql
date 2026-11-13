-- ─────────────────────────────────────────────────────────────────────────────
--  Announcements: an admin posts a message → it pops up on everyone's screen
--  (live, on every page) until each person closes it.
--  Run in the Trilo Attendance Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.projects WHERE name = 'Coldstar_PUNE - G+2 Spiral Chute') THEN RAISE EXCEPTION 'Wrong database — run this in the Trilo Attendance project'; END IF; END $$;

CREATE TABLE IF NOT EXISTS public.announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL CHECK (length(trim(title)) > 0),
  message     text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true,      -- admin can stop showing it
  expires_at  timestamptz,                         -- optional "show until"
  created_by  uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_created_idx ON public.announcements (created_at DESC);

CREATE TABLE IF NOT EXISTS public.announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dismissed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;

-- everyone signed in reads announcements; only admins post / edit / delete
DROP POLICY IF EXISTS ann_read ON public.announcements;
CREATE POLICY ann_read ON public.announcements FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS ann_admin_write ON public.announcements;
CREATE POLICY ann_admin_write ON public.announcements FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- each person records their own "closed"; admins can see who has seen it
DROP POLICY IF EXISTS ann_dis_read ON public.announcement_dismissals;
CREATE POLICY ann_dis_read ON public.announcement_dismissals FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS ann_dis_insert ON public.announcement_dismissals;
CREATE POLICY ann_dis_insert ON public.announcement_dismissals FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.announcements, public.announcement_dismissals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT SELECT, INSERT ON public.announcement_dismissals TO authenticated;

-- live pop-up as soon as it is posted
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'announcements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
  END IF;
END $$;
ALTER TABLE public.announcements REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';
