-- Subproject: add "Production"
ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_sub_project_check;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_sub_project_check
  CHECK (sub_project IS NULL OR sub_project IN ('electrical','mechanical','consumables','internal_transport','external_transport','production'));
NOTIFY pgrst, 'reload schema';
