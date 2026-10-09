-- Deleting a form (or a log entry) gives its running number back when it was the latest one,
-- so the next form reuses it. (Numbers in the middle stay as gaps — issued paper copies keep theirs.)

CREATE OR REPLACE FUNCTION public._ref_num(p_ref text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(substring(coalesce(p_ref, '') FROM '(\d+)\D*$'), '')::integer
$$;

CREATE OR REPLACE FUNCTION public._renumber_after_log_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur integer; v_del integer;
BEGIN
  SELECT current_number INTO v_cur FROM production_forms WHERE id = OLD.form_id FOR UPDATE;
  IF NOT FOUND THEN RETURN OLD; END IF;
  v_del := public._ref_num(OLD.reference_value);
  IF v_del IS NULL OR v_del <> v_cur THEN RETURN OLD; END IF;   -- not the latest number → leave a gap
  UPDATE production_forms
     SET current_number = greatest(v_cur - 1, 0), updated_at = now()
   WHERE id = OLD.form_id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_renumber_after_log_delete ON public.production_form_opens;
CREATE TRIGGER trg_renumber_after_log_delete AFTER DELETE ON public.production_form_opens
  FOR EACH ROW EXECUTE FUNCTION public._renumber_after_log_delete();

-- Delete a form request: admins any; the requester their own until it is authorized
CREATE OR REPLACE FUNCTION public.delete_form_request(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r form_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;
  IF NOT (public.is_admin(auth.uid()) OR (r.requested_by = auth.uid() AND r.status <> 'authorized')) THEN
    RAISE EXCEPTION 'You cannot delete this form';
  END IF;
  DELETE FROM notifications WHERE type = 'form' AND reference_id = p_id;
  DELETE FROM form_requests WHERE id = p_id;
  IF r.reference_value IS NOT NULL THEN
    DELETE FROM production_form_opens WHERE form_id = r.form_id AND reference_value = r.reference_value;
  END IF;
END;
$$;

-- Delete a log entry (admins) — also removes a form request that used the number
CREATE OR REPLACE FUNCTION public.delete_form_log(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o production_form_opens%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only admins can delete log entries'; END IF;
  SELECT * INTO o FROM production_form_opens WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  DELETE FROM notifications WHERE type = 'form' AND reference_id IN
    (SELECT id FROM form_requests WHERE form_id = o.form_id AND reference_value = o.reference_value);
  DELETE FROM form_requests WHERE form_id = o.form_id AND reference_value = o.reference_value;
  DELETE FROM production_form_opens WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_form_request(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.delete_form_log(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_form_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_form_log(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
