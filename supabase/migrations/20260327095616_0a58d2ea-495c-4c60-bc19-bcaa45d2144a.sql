
-- Drop the partially created table
DROP TABLE IF EXISTS public.team_meetings CASCADE;

-- Create both tables first
CREATE TABLE public.team_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  meeting_link text,
  scheduled_at timestamp with time zone NOT NULL,
  duration_minutes integer DEFAULT 30,
  created_by uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'scheduled'
);

CREATE TABLE public.team_meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.team_meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(meeting_id, user_id)
);

-- RLS on team_meetings
ALTER TABLE public.team_meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage meetings" ON public.team_meetings
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Users can read their meetings" ON public.team_meetings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_meeting_participants
      WHERE team_meeting_participants.meeting_id = team_meetings.id
        AND team_meeting_participants.user_id = auth.uid()
    )
  );

-- RLS on participants
ALTER TABLE public.team_meeting_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage participants" ON public.team_meeting_participants
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Users can read own participations" ON public.team_meeting_participants
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own participation" ON public.team_meeting_participants
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Trigger: notify participants when added to meeting
CREATE OR REPLACE FUNCTION public.notify_meeting_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  meeting_title text;
BEGIN
  SELECT title INTO meeting_title FROM team_meetings WHERE id = NEW.meeting_id;
  INSERT INTO notifications (user_id, title, body, type, reference_id)
  VALUES (
    NEW.user_id,
    'New team meeting',
    'You are invited to: ' || meeting_title,
    'meeting',
    NEW.meeting_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_meeting_participant_added
  AFTER INSERT ON public.team_meeting_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_meeting_participants();

ALTER PUBLICATION supabase_realtime ADD TABLE public.team_meetings;
