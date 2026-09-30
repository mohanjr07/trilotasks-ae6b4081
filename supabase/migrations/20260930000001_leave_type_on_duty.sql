-- Allow "On Duty" requests: the Assign Leave form saves type = 'on_duty'.
ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_type_check;
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_type_check
  CHECK (type IN ('leave','permission','on_duty'));
