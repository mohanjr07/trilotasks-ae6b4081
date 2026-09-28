-- Restore the e-mail trigger on notifications (missing on the new project).
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS email_sent boolean DEFAULT false;

DROP TRIGGER IF EXISTS trigger_send_email_on_notification ON public.notifications;
CREATE TRIGGER trigger_send_email_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.send_email_on_notification();

-- Check: should list both triggers with tgenabled = 'O'
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal;
