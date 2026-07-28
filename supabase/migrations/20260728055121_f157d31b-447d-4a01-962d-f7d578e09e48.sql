GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kra_kpi TO authenticated;
GRANT ALL ON public.kra_kpi TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_policy TO authenticated;
GRANT ALL ON public.leave_policy TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_requests TO authenticated;
GRANT ALL ON public.leave_requests TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organisation_flow_nodes TO authenticated;
GRANT ALL ON public.organisation_flow_nodes TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_teams TO authenticated;
GRANT ALL ON public.project_teams TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_assignees TO authenticated;
GRANT ALL ON public.task_assignees TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_attachments TO authenticated;
GRANT ALL ON public.task_attachments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_columns TO authenticated;
GRANT ALL ON public.task_columns TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_meeting_participants TO authenticated;
GRANT ALL ON public.team_meeting_participants TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_meetings TO authenticated;
GRANT ALL ON public.team_meetings TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_documents TO authenticated;
GRANT ALL ON public.user_documents TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_notes TO authenticated;
GRANT ALL ON public.user_notes TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_task_column_prefs TO authenticated;
GRANT ALL ON public.user_task_column_prefs TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_task_columns TO authenticated;
GRANT ALL ON public.user_task_columns TO service_role;