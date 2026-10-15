-- Optional comment when a manager verifies a payment request (admins' comment uses review_note)
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS verify_note text;

CREATE OR REPLACE FUNCTION public.verify_payment_request(p_id uuid, p_ok boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.payment_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.verifier_id IS DISTINCT FROM auth.uid() OR r.status <> 'pending_verification' THEN
    RAISE EXCEPTION 'This request is not waiting for your verification';
  END IF;
  IF p_ok THEN
    UPDATE public.payment_requests
       SET status = 'pending', verified_at = now(), verify_note = nullif(trim(coalesce(p_note, '')), '')
     WHERE id = p_id;
  ELSE
    IF coalesce(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Please give a reason for rejecting'; END IF;
    UPDATE public.payment_requests
       SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = trim(p_note)
     WHERE id = p_id;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verify_payment_request(uuid, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.verify_payment_request(uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
