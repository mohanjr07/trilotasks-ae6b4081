-- ─────────────────────────────────────────────────────────────────────────────
--  Purchase Orders, tracked against projects and payments
--  • A project can have several POs, of two kinds:
--      customer — the client's order to us (e.g. CAT's PO for the conveyor)
--      vendor   — our order on a supplier (e.g. PO to Anand Steels)
--  • Each PO: number, party, date, value, notes and the PO document (PDF / photo).
--  • A payment request can be linked to one PO of its project; totals per PO are
--    worked out from the approved payments linked to it.
--  • Admins create / edit POs and link payments; admins, Hari and Anu see PO values.
--    Everyone raising a payment can pick a PO number (number + party only).
--  Run in the Trilo Attendance Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.projects WHERE name = 'Coldstar_PUNE - G+2 Spiral Chute') THEN RAISE EXCEPTION 'Wrong database — run this in the Trilo Attendance project'; END IF; END $$;

-- who may see PO values (admins, expense viewers such as Hari, and Anu)
CREATE OR REPLACE FUNCTION public.can_see_po(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = uid AND role IN ('admin','super_admin'))
      OR public.is_expense_viewer(uid)
      OR EXISTS (SELECT 1 FROM profiles WHERE id = uid AND lower(email) = 'anu@triloautomation.com')
$$;
REVOKE EXECUTE ON FUNCTION public.can_see_po(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_see_po(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer','vendor')),
  po_number   text NOT NULL CHECK (length(trim(po_number)) > 0),
  party       text,                                   -- customer or vendor name
  po_date     date,
  value       numeric(14,2) CHECK (value IS NULL OR value >= 0),
  notes       text,
  doc_path    text,                                   -- in the private "po-documents" bucket
  doc_name    text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by  uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_orders_project_idx ON public.purchase_orders (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_unique_no ON public.purchase_orders (project_id, kind, lower(trim(po_number)));

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_read ON public.purchase_orders;
CREATE POLICY po_read ON public.purchase_orders FOR SELECT TO authenticated USING (public.can_see_po(auth.uid()));
DROP POLICY IF EXISTS po_admin_write ON public.purchase_orders;
CREATE POLICY po_admin_write ON public.purchase_orders FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.purchase_orders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;

CREATE OR REPLACE FUNCTION public._po_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_po_touch ON public.purchase_orders;
CREATE TRIGGER trg_po_touch BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public._po_touch();

-- PO numbers of a project for the "Purchase Order" dropdown on a payment request (no values)
CREATE OR REPLACE FUNCTION public.project_po_options(p_project uuid)
RETURNS TABLE (id uuid, po_number text, kind text, party text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, po_number, kind, party FROM purchase_orders
   WHERE project_id = p_project AND status = 'open' AND auth.uid() IS NOT NULL
   ORDER BY kind, po_date NULLS LAST, po_number
$$;
REVOKE EXECUTE ON FUNCTION public.project_po_options(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.project_po_options(uuid) TO authenticated;

-- link payments to a PO
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payment_requests_po_idx ON public.payment_requests (po_id);

-- a payment's PO must belong to the payment's project; moving the payment to another project unlinks it
CREATE OR REPLACE FUNCTION public._payment_po_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.po_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM purchase_orders po WHERE po.id = NEW.po_id AND po.project_id IS NOT DISTINCT FROM NEW.project_id) THEN
    IF TG_OP = 'UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      NEW.po_id := NULL;                                  -- project changed → old PO no longer applies
    ELSE
      RAISE EXCEPTION 'That purchase order belongs to another project';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_payment_po_check ON public.payment_requests;
CREATE TRIGGER trg_payment_po_check BEFORE INSERT OR UPDATE OF po_id, project_id ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public._payment_po_check();

-- admins: link / unlink a payment and a PO (also after approval or payment)
CREATE OR REPLACE FUNCTION public.set_payment_po(p_id uuid, p_po uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only admins can link payments to purchase orders'; END IF;
  UPDATE payment_requests SET po_id = p_po WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.set_payment_po(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_payment_po(uuid, uuid) TO authenticated;

-- PO documents: private bucket; admins upload, PO viewers open
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('po-documents', 'po-documents', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false;
DROP POLICY IF EXISTS po_docs_read ON storage.objects;
CREATE POLICY po_docs_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'po-documents' AND public.can_see_po(auth.uid()));
DROP POLICY IF EXISTS po_docs_write ON storage.objects;
CREATE POLICY po_docs_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'po-documents' AND public.is_admin(auth.uid()));
DROP POLICY IF EXISTS po_docs_delete ON storage.objects;
CREATE POLICY po_docs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'po-documents' AND public.is_admin(auth.uid()));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'purchase_orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.purchase_orders;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
