-- ─────────────────────────────────────────────────────────────────────────────
--  Sales Orders and Purchase Orders are now separate:
--  • Sales Order (SO)    = the customer's order for a project. NOT linked to payments.
--  • Purchase Order (PO) = our order on a supplier for a project. Payments are linked to it.
--  This file: only Purchase Orders can be picked on a payment, and any payment that was
--  linked to a Sales Order is unlinked (the payment itself is not changed otherwise).
--  Run AFTER TRILO_purchase_orders.sql, in the Trilo Attendance Supabase project.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.projects WHERE name = 'Coldstar_PUNE - G+2 Spiral Chute') THEN RAISE EXCEPTION 'Wrong database — run this in the Trilo Attendance project'; END IF; END $$;

-- dropdown on a payment request: Purchase Orders of the project only
CREATE OR REPLACE FUNCTION public.project_po_options(p_project uuid)
RETURNS TABLE (id uuid, po_number text, kind text, party text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, po_number, kind, party FROM purchase_orders
   WHERE project_id = p_project AND kind = 'vendor' AND status = 'open' AND auth.uid() IS NOT NULL
   ORDER BY po_date NULLS LAST, po_number
$$;

-- a payment can only be linked to a Purchase Order of its own project
CREATE OR REPLACE FUNCTION public._payment_po_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_po purchase_orders%ROWTYPE;
BEGIN
  IF NEW.po_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_po FROM purchase_orders WHERE id = NEW.po_id;
  IF v_po.kind IS DISTINCT FROM 'vendor' THEN
    RAISE EXCEPTION 'Payments can only be linked to a purchase order (not a sales order)';
  END IF;
  IF v_po.project_id IS DISTINCT FROM NEW.project_id THEN
    IF TG_OP = 'UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      NEW.po_id := NULL;                                  -- project changed → old PO no longer applies
    ELSE
      RAISE EXCEPTION 'That purchase order belongs to another project';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.set_payment_po(p_id uuid, p_po uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only admins can link payments to purchase orders'; END IF;
  UPDATE payment_requests SET po_id = p_po WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
END; $$;

-- payments that were linked to a Sales Order → unlinked
DO $$ BEGIN
  ALTER TABLE public.payment_requests DISABLE TRIGGER USER;      -- no notifications for this tidy-up
  UPDATE public.payment_requests SET po_id = NULL
   WHERE po_id IN (SELECT id FROM public.purchase_orders WHERE kind = 'customer');
  ALTER TABLE public.payment_requests ENABLE TRIGGER USER;
END $$;

NOTIFY pgrst, 'reload schema';
