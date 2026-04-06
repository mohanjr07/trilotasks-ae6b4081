CREATE OR REPLACE FUNCTION public.send_email_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://oqlorimxwhtrmjxlvllt.supabase.co/functions/v1/send-email-notification',
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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xbG9yaW14d2h0cm1qeGx2bGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTA0MjcsImV4cCI6MjA4OTgyNjQyN30.sRPVx-eBK7JgHm07DsM440EfnYbNLxtZzjh0QSldhRE'
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Email notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;