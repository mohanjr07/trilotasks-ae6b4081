-- ─────────────────────────────────────────────────────────────────────────────
--  Push notifications for the TaskFlow Android app (Firebase Cloud Messaging)
--  + fix: e-mail trigger still pointed at the old Lovable project.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. One row per phone that has the app installed and logged in
CREATE TABLE IF NOT EXISTS public.push_tokens (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform    text NOT NULL DEFAULT 'android',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens(user_id);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens_own_select" ON public.push_tokens;
CREATE POLICY "push_tokens_own_select" ON public.push_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "push_tokens_own_insert" ON public.push_tokens;
CREATE POLICY "push_tokens_own_insert" ON public.push_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "push_tokens_own_update" ON public.push_tokens;
CREATE POLICY "push_tokens_own_update" ON public.push_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "push_tokens_own_delete" ON public.push_tokens;
CREATE POLICY "push_tokens_own_delete" ON public.push_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- A phone that switches account: move its token to the new user
CREATE OR REPLACE FUNCTION public.claim_push_token(p_token text, p_platform text DEFAULT 'android')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.push_tokens (token, user_id, platform, updated_at)
  VALUES (p_token, auth.uid(), p_platform, now())
  ON CONFLICT (token) DO UPDATE SET user_id = auth.uid(), platform = EXCLUDED.platform, updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.claim_push_token(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_push_token(text, text) TO authenticated;

-- 2. Mark notifications that have been pushed (stops duplicates)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_sent boolean DEFAULT false;

-- 3. New notification row → call the send-push edge function
CREATE OR REPLACE FUNCTION public.send_push_on_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://jhtfhjfwjsutkwebmrgv.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('record', jsonb_build_object('id', NEW.id)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpodGZoamZ3anN1dGt3ZWJtcmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMjI5ODMsImV4cCI6MjEwNTg5ODk4M30.prOaWH_fG6ywrim_-SJKaMP2wp8kTl_xQoW7CBIkMNQ'
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Push notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_send_push_on_notification ON public.notifications;
CREATE TRIGGER trigger_send_push_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.send_push_on_notification();

-- 4. FIX: e-mail trigger → this project (was still the old Lovable URL/key)
CREATE OR REPLACE FUNCTION public.send_email_on_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://jhtfhjfwjsutkwebmrgv.supabase.co/functions/v1/send-email-notification',
    body := jsonb_build_object('record', jsonb_build_object(
      'id', NEW.id, 'user_id', NEW.user_id, 'title', NEW.title,
      'body', NEW.body, 'type', NEW.type, 'reference_id', NEW.reference_id)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpodGZoamZ3anN1dGt3ZWJtcmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMjI5ODMsImV4cCI6MjEwNTg5ODk4M30.prOaWH_fG6ywrim_-SJKaMP2wp8kTl_xQoW7CBIkMNQ'
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Email notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
