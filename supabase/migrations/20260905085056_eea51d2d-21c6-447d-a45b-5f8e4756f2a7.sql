CREATE OR REPLACE FUNCTION public.notify_leave_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_name text;
  admin_id uuid;
BEGIN
  SELECT full_name INTO emp_name FROM profiles WHERE id = NEW.employee_id;
  FOR admin_id IN SELECT id FROM profiles WHERE role IN ('admin', 'super_admin') AND id != NEW.employee_id
  LOOP
    INSERT INTO notifications (user_id, title, body, type, reference_id)
    VALUES (
      admin_id,
      'New ' || NEW.type || ' request',
      emp_name || ' requested ' || NEW.type || ': ' || NEW.start_date,
      'leave',
      NEW.id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_leave_submitted ON public.leave_requests;
CREATE TRIGGER trg_notify_leave_submitted
AFTER INSERT ON public.leave_requests
FOR EACH ROW
EXECUTE FUNCTION public.notify_leave_submitted();