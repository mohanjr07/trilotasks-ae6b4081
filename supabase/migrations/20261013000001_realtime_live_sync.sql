-- Live updates: every table the app shows is broadcast over realtime, so screens
-- refresh the moment something changes (replaces polling every 5 seconds).
-- Safe to run more than once. Row-level security still decides who sees what.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tasks','task_assignees','task_comments','task_attachments','task_columns',
    'form_requests','production_forms','production_form_opens',
    'payment_requests','leave_requests','overtime_entries','overtime_members',
    'notifications','projects','project_members','project_teams',
    'assets','user_documents','holidays','team_meetings','team_meeting_participants',
    'kra_kpi','profiles','attendance'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;
