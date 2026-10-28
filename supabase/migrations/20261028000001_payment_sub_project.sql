-- Payment requests: Subproject (Electrical / Mechanical / Consumables / Internal Transport / External Transport)
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS sub_project text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_sub_project_check') THEN
    ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_sub_project_check
      CHECK (sub_project IS NULL OR sub_project IN ('electrical','mechanical','consumables','internal_transport','external_transport'));
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
