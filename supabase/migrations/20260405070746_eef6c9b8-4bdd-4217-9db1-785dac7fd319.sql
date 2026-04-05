
-- Add email_sent tracking column
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS email_sent boolean DEFAULT false;

-- Enable pg_net extension for async HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create trigger function to call the edge function asynchronously
CREATE OR REPLACE FUNCTION public.send_email_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  edge_function_url text;
  service_key text;
BEGIN
  edge_function_url := 'https://oqlorimxwhtrmjxlvllt.supabase.co/functions/v1/send-email-notification';
  service_key := current_setting('app.settings.service_role_key', true);
  
  -- Use pg_net for async HTTP POST (fire-and-forget, won't block insert)
  PERFORM extensions.http_post(
    url := edge_function_url,
    body := jsonb_build_object(
      'record', jsonb_build_object(
        'id', NEW.id,
        'user_id', NEW.user_id,
        'title', NEW.title,
        'body', NEW.body,
        'type', NEW.type,
        'reference_id', NEW.reference_id
      )
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xbG9yaW14d2h0cm1qeGx2bGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTA0MjcsImV4cCI6MjA4OTgyNjQyN30.sRPVx-eBK7JgHm07DsM440EfnYbNLxtZzjh0QSldhRE'
    )
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let email sending break notification creation
  RAISE WARNING 'Email notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Create trigger on notifications table
DROP TRIGGER IF EXISTS trigger_send_email_on_notification ON public.notifications;
CREATE TRIGGER trigger_send_email_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.send_email_on_notification();
