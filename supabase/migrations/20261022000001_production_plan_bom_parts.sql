-- ─────────────────────────────────────────────────────────────────────────────
--  Production Plan — BOM parts & approval.
--  • The BOM is built part by part (e.g. "Frame", "Electrical", "Rev 2 — wheel change").
--    Anyone in the plan can prepare a part: add lines, import from Excel, and — for
--    revisions — change or remove lines that are already in the final BOM.
--  • A part is sent to a manager/admin for approval. Approved → its lines are merged
--    into ONE final BOM. Sent back → the author fixes it and sends it again.
--  • The final BOM is locked: changes only through a new part (revision).
--    Admins/managers/plan owner can still update the procurement status of final lines.
--  Needs: Production Plan, BOM and access SQL run first.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.pp_bom_items') IS NULL THEN RAISE EXCEPTION 'Run the Production Plan BOM SQL first'; END IF;
  IF to_regprocedure('public._pp_can_view(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'Run the Production Plan access SQL first'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.pp_bom_parts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected')),
  approver_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note         text,                 -- author's note when sending
  comment      text,                 -- approver's comment
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  decided_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pp_bom_parts_project_idx ON public.pp_bom_parts (project_id, created_at);

ALTER TABLE public.pp_bom_items ADD COLUMN IF NOT EXISTS part_id uuid REFERENCES public.pp_bom_parts(id) ON DELETE CASCADE;
ALTER TABLE public.pp_bom_items ADD COLUMN IF NOT EXISTS is_final boolean NOT NULL DEFAULT false;
ALTER TABLE public.pp_bom_items ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'add';
ALTER TABLE public.pp_bom_items ADD COLUMN IF NOT EXISTS replaces_id uuid REFERENCES public.pp_bom_items(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pp_bom_items_action_check') THEN
    ALTER TABLE public.pp_bom_items ADD CONSTRAINT pp_bom_items_action_check CHECK (action IN ('add','change','remove'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS pp_bom_items_part_idx ON public.pp_bom_items (part_id);
-- lines added before parts existed are the approved BOM
UPDATE public.pp_bom_items SET is_final = true WHERE part_id IS NULL AND NOT is_final;

ALTER TABLE public.pp_bom_parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pp_bom_parts_read ON public.pp_bom_parts;
CREATE POLICY pp_bom_parts_read ON public.pp_bom_parts FOR SELECT TO authenticated USING (public._pp_can_view(project_id, auth.uid()));
REVOKE ALL ON public.pp_bom_parts FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pp_bom_parts FROM authenticated;
GRANT SELECT ON public.pp_bom_parts TO authenticated;

-- the old direct-edit functions are replaced by the part functions below
DROP FUNCTION IF EXISTS public.pp_bom_save(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.pp_bom_delete(uuid);
DROP FUNCTION IF EXISTS public.pp_bom_move(uuid, integer);
DROP FUNCTION IF EXISTS public.pp_bom_import(uuid, jsonb, boolean);

-- ── helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._pp_part_editable(p_part uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.pp_bom_parts b WHERE b.id = p_part AND b.status IN ('draft','rejected')
                   AND (b.created_by = p_user OR public._pp_can_manage(b.project_id, p_user)))
$$;
REVOKE EXECUTE ON FUNCTION public._pp_part_editable(uuid, uuid) FROM anon, public;

CREATE OR REPLACE FUNCTION public._pp_bom_fields(o public.pp_bom_items, f jsonb)
RETURNS public.pp_bom_items LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF f ? 'part_no'     THEN o.part_no     := nullif(trim(f->>'part_no'),''); END IF;
  IF f ? 'description' THEN o.description := trim(f->>'description'); END IF;
  IF f ? 'material'    THEN o.material    := nullif(trim(f->>'material'),''); END IF;
  IF f ? 'qty'         THEN o.qty         := coalesce(nullif(regexp_replace(f->>'qty', '[^0-9.]', '', 'g'),'')::numeric, 0); END IF;
  IF f ? 'unit'        THEN o.unit        := coalesce(nullif(trim(f->>'unit'),''), 'Nos'); END IF;
  IF f ? 'make_buy'    THEN o.make_buy    := CASE WHEN initcap(trim(coalesce(f->>'make_buy',''))) IN ('Make','Buy') THEN initcap(trim(f->>'make_buy')) END; END IF;
  IF f ? 'vendor'      THEN o.vendor      := nullif(trim(f->>'vendor'),''); END IF;
  IF f ? 'unit_cost'   THEN o.unit_cost   := nullif(regexp_replace(coalesce(f->>'unit_cost',''), '[^0-9.]', '', 'g'),'')::numeric; END IF;
  IF f ? 'status'      THEN o.status      := CASE WHEN lower(trim(coalesce(f->>'status',''))) IN ('required','ordered','received','issued') THEN lower(trim(f->>'status')) ELSE 'required' END; END IF;
  IF f ? 'remarks'     THEN o.remarks     := nullif(trim(f->>'remarks'),''); END IF;
  RETURN o;
END;
$$;

-- ── parts ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pp_bom_part_create(p_project_id uuid, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pp_plans WHERE project_id = p_project_id) THEN RAISE EXCEPTION 'Plan not found'; END IF;
  IF NOT public._pp_can_view(p_project_id, auth.uid()) THEN RAISE EXCEPTION 'Only people in this plan can add BOM parts'; END IF;
  IF nullif(trim(coalesce(p_name,'')), '') IS NULL THEN RAISE EXCEPTION 'Give the part a name'; END IF;
  INSERT INTO public.pp_bom_parts (project_id, name, created_by) VALUES (p_project_id, trim(p_name), auth.uid()) RETURNING id INTO v_id;
  PERFORM public._pp_bom_log(p_project_id, 'New BOM part: ' || trim(p_name));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pp_bom_part_rename(p_part_id uuid, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._pp_part_editable(p_part_id, auth.uid()) THEN RAISE EXCEPTION 'This part can no longer be changed'; END IF;
  IF nullif(trim(coalesce(p_name,'')), '') IS NULL THEN RAISE EXCEPTION 'Give the part a name'; END IF;
  UPDATE public.pp_bom_parts SET name = trim(p_name), updated_at = now() WHERE id = p_part_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pp_bom_part_delete(p_part_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.pp_bom_parts%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.pp_bom_parts WHERE id = p_part_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Part not found'; END IF;
  IF NOT public._pp_part_editable(p_part_id, auth.uid()) THEN RAISE EXCEPTION 'Only a draft or sent-back part can be deleted'; END IF;
  DELETE FROM public.pp_bom_parts WHERE id = p_part_id;
  PERFORM public._pp_bom_log(b.project_id, 'Deleted BOM part: ' || b.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.pp_bom_part_submit(p_part_id uuid, p_approver uuid, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.pp_bom_parts%ROWTYPE; v_n int; v_pname text;
BEGIN
  SELECT * INTO b FROM public.pp_bom_parts WHERE id = p_part_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Part not found'; END IF;
  IF NOT public._pp_part_editable(p_part_id, auth.uid()) THEN RAISE EXCEPTION 'This part cannot be sent now'; END IF;
  SELECT count(*) INTO v_n FROM public.pp_bom_items WHERE part_id = p_part_id;
  IF v_n = 0 THEN RAISE EXCEPTION 'Add at least one line before sending for approval'; END IF;
  IF p_approver IS NULL THEN RAISE EXCEPTION 'Choose who approves this part'; END IF;
  IF p_approver = auth.uid() THEN RAISE EXCEPTION 'Choose someone else to approve your part'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_approver AND coalesce(is_active, true) AND role IN ('admin','super_admin','manager')) THEN
    RAISE EXCEPTION 'The approver must be a manager or an admin';
  END IF;
  UPDATE public.pp_bom_parts SET status = 'pending', approver_id = p_approver, note = nullif(trim(coalesce(p_note,'')),''),
         comment = NULL, submitted_at = now(), decided_at = NULL, decided_by = NULL, updated_at = now()
   WHERE id = p_part_id;
  SELECT name INTO v_pname FROM public.projects WHERE id = b.project_id;
  PERFORM public._pp_bom_log(b.project_id, 'BOM part "' || b.name || '" (' || v_n || ' lines) sent to ' || public._pp_name(p_approver) || ' for approval');
  PERFORM public._pp_notify(p_approver, 'BOM part waiting for your approval',
    public._pp_name(auth.uid()) || ' sent "' || b.name || '" (' || v_n || ' lines) — ' || coalesce(v_pname, ''), b.project_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.pp_bom_part_withdraw(p_part_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.pp_bom_parts%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.pp_bom_parts WHERE id = p_part_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'pending' THEN RAISE EXCEPTION 'Only a part waiting for approval can be withdrawn'; END IF;
  IF NOT (b.created_by = auth.uid() OR public._pp_can_manage(b.project_id, auth.uid())) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.pp_bom_parts SET status = 'draft', updated_at = now() WHERE id = p_part_id;
  PERFORM public._pp_bom_log(b.project_id, 'BOM part "' || b.name || '" withdrawn from approval');
  PERFORM public._pp_notify(b.approver_id, 'BOM approval withdrawn', b.name, b.project_id);
END;
$$;

-- approve → merge into the final BOM; send back → author edits again
CREATE OR REPLACE FUNCTION public.pp_bom_part_decide(p_part_id uuid, p_approve boolean, p_comment text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.pp_bom_parts%ROWTYPE; r record; v_comment text := nullif(trim(coalesce(p_comment,'')), '');
  v_add int := 0; v_chg int := 0; v_rem int := 0;
BEGIN
  SELECT * INTO b FROM public.pp_bom_parts WHERE id = p_part_id FOR UPDATE;
  IF NOT FOUND OR b.status <> 'pending' THEN RAISE EXCEPTION 'This part is not waiting for approval'; END IF;
  IF NOT (b.approver_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))) THEN
    RAISE EXCEPTION 'Only the approver or an admin can decide this part';
  END IF;
  IF b.created_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own part'; END IF;

  IF NOT p_approve THEN
    IF v_comment IS NULL THEN RAISE EXCEPTION 'Add a comment saying what to fix'; END IF;
    UPDATE public.pp_bom_parts SET status = 'rejected', comment = v_comment, decided_by = auth.uid(), decided_at = now(), updated_at = now() WHERE id = p_part_id;
    PERFORM public._pp_bom_log(b.project_id, 'BOM part "' || b.name || '" sent back: ' || v_comment);
    PERFORM public._pp_notify(b.created_by, 'BOM part sent back', b.name || ' — ' || v_comment, b.project_id);
    RETURN;
  END IF;

  -- 1. new lines: the part's own top lines go to the end of the final BOM (or of the final assembly they sit under)
  FOR r IN SELECT i.* FROM public.pp_bom_items i
            WHERE i.part_id = p_part_id AND i.action = 'add'
              AND (i.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.pp_bom_items x WHERE x.id = i.parent_id AND x.part_id = p_part_id))
            ORDER BY i.sort_order, i.created_at LOOP
    UPDATE public.pp_bom_items SET is_final = true, updated_at = now(),
           sort_order = coalesce((SELECT max(sort_order) + 1 FROM public.pp_bom_items
                                   WHERE project_id = b.project_id AND is_final AND parent_id IS NOT DISTINCT FROM r.parent_id), 0)
     WHERE id = r.id;
  END LOOP;
  UPDATE public.pp_bom_items SET is_final = true, updated_at = now() WHERE part_id = p_part_id AND action = 'add' AND NOT is_final;
  SELECT count(*) INTO v_add FROM public.pp_bom_items WHERE part_id = p_part_id AND action = 'add';

  -- 2. changed lines: copy the new values onto the final line
  UPDATE public.pp_bom_items f SET part_no = l.part_no, description = l.description, material = l.material, qty = l.qty, unit = l.unit,
         make_buy = l.make_buy, vendor = l.vendor, unit_cost = l.unit_cost, remarks = l.remarks, updated_at = now()
    FROM public.pp_bom_items l
   WHERE l.part_id = p_part_id AND l.action = 'change' AND f.id = l.replaces_id AND f.is_final;
  GET DIAGNOSTICS v_chg = ROW_COUNT;

  -- 3. removed lines (and everything under them)
  DELETE FROM public.pp_bom_items f
   WHERE f.is_final AND f.id IN (SELECT l.replaces_id FROM public.pp_bom_items l WHERE l.part_id = p_part_id AND l.action = 'remove');
  GET DIAGNOSTICS v_rem = ROW_COUNT;

  UPDATE public.pp_bom_parts SET status = 'approved', comment = v_comment, decided_by = auth.uid(), decided_at = now(), updated_at = now() WHERE id = p_part_id;
  PERFORM public._pp_bom_log(b.project_id, 'BOM part "' || b.name || '" approved — merged into the final BOM: '
    || v_add || ' added, ' || v_chg || ' changed, ' || v_rem || ' removed' || coalesce(' — ' || v_comment, ''));
  PERFORM public._pp_notify(b.created_by, 'BOM part approved', b.name || ' is now in the final BOM' || coalesce(' — ' || v_comment, ''), b.project_id);
END;
$$;

-- ── lines inside a part ─────────────────────────────────────────────────────
-- p_fields may hold: part_no, description, material, qty, unit, make_buy, vendor, unit_cost, status, remarks,
-- and on create: action ('add' | 'change' | 'remove') + replaces_id (a final line) for change / remove.
CREATE OR REPLACE FUNCTION public.pp_bom_line_save(p_id uuid, p_part_id uuid, p_parent_id uuid, p_fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f jsonb := coalesce(p_fields, '{}'::jsonb); b public.pp_bom_parts%ROWTYPE; o public.pp_bom_items%ROWTYPE; fin public.pp_bom_items%ROWTYPE;
  v_action text; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF p_id IS NULL THEN
    SELECT * INTO b FROM public.pp_bom_parts WHERE id = p_part_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Part not found'; END IF;
    IF NOT public._pp_part_editable(p_part_id, auth.uid()) THEN RAISE EXCEPTION 'This part can no longer be changed'; END IF;
    v_action := coalesce(nullif(f->>'action',''), 'add');
    IF v_action NOT IN ('add','change','remove') THEN RAISE EXCEPTION 'Unknown action'; END IF;

    IF v_action = 'add' THEN
      IF nullif(trim(coalesce(f->>'description','')), '') IS NULL THEN RAISE EXCEPTION 'Enter a description'; END IF;
      IF p_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pp_bom_items WHERE id = p_parent_id AND project_id = b.project_id
                                                   AND (part_id = p_part_id OR is_final)) THEN
        RAISE EXCEPTION 'Parent line not found';
      END IF;
      o.id := gen_random_uuid(); o.project_id := b.project_id; o.part_id := p_part_id; o.parent_id := p_parent_id; o.action := 'add';
      o.qty := 1; o.unit := 'Nos'; o.status := 'required';
      o := public._pp_bom_fields(o, f);
    ELSE
      SELECT * INTO fin FROM public.pp_bom_items WHERE id = nullif(f->>'replaces_id','')::uuid AND project_id = b.project_id AND is_final;
      IF NOT FOUND THEN RAISE EXCEPTION 'Choose a line from the final BOM'; END IF;
      IF EXISTS (SELECT 1 FROM public.pp_bom_items WHERE part_id = p_part_id AND replaces_id = fin.id) THEN
        RAISE EXCEPTION 'This part already changes or removes that line';
      END IF;
      o := fin; o.id := gen_random_uuid(); o.part_id := p_part_id; o.is_final := false; o.action := v_action; o.replaces_id := fin.id;
      o.parent_id := fin.parent_id;
      IF v_action = 'change' THEN o := public._pp_bom_fields(o, f); END IF;
    END IF;
    o.sort_order := coalesce((SELECT max(sort_order) + 1 FROM public.pp_bom_items WHERE part_id = p_part_id AND parent_id IS NOT DISTINCT FROM o.parent_id), 0);
    o.is_final := false; o.created_by := auth.uid(); o.created_at := now(); o.updated_at := now();
    IF nullif(trim(coalesce(o.description,'')), '') IS NULL THEN RAISE EXCEPTION 'Enter a description'; END IF;
    INSERT INTO public.pp_bom_items SELECT o.* RETURNING id INTO v_id;
    UPDATE public.pp_bom_parts SET updated_at = now() WHERE id = p_part_id;
    RETURN v_id;
  END IF;

  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  IF o.is_final THEN RAISE EXCEPTION 'The final BOM is locked — change it through a new part'; END IF;
  IF o.part_id IS NULL OR NOT public._pp_part_editable(o.part_id, auth.uid()) THEN RAISE EXCEPTION 'This part can no longer be changed'; END IF;
  IF o.action = 'remove' THEN RAISE EXCEPTION 'A remove line has nothing to edit'; END IF;
  IF f ? 'description' AND nullif(trim(coalesce(f->>'description','')), '') IS NULL THEN RAISE EXCEPTION 'Enter a description'; END IF;
  o := public._pp_bom_fields(o, f - 'action' - 'replaces_id');
  o.updated_at := now();
  UPDATE public.pp_bom_items SET part_no = o.part_no, description = o.description, material = o.material, qty = o.qty, unit = o.unit,
         make_buy = o.make_buy, vendor = o.vendor, unit_cost = o.unit_cost, status = o.status, remarks = o.remarks, updated_at = now()
   WHERE id = p_id;
  UPDATE public.pp_bom_parts SET updated_at = now() WHERE id = o.part_id;
  RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pp_bom_line_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.pp_bom_items%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  IF o.is_final THEN RAISE EXCEPTION 'The final BOM is locked — remove lines through a new part'; END IF;
  IF o.part_id IS NULL OR NOT public._pp_part_editable(o.part_id, auth.uid()) THEN RAISE EXCEPTION 'This part can no longer be changed'; END IF;
  DELETE FROM public.pp_bom_items WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pp_bom_line_move(p_id uuid, p_dir integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.pp_bom_items%ROWTYPE; s public.pp_bom_items%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id;
  IF NOT FOUND OR o.is_final OR o.part_id IS NULL THEN RAISE EXCEPTION 'Line not found'; END IF;
  IF NOT public._pp_part_editable(o.part_id, auth.uid()) THEN RAISE EXCEPTION 'This part can no longer be changed'; END IF;
  WITH r AS (SELECT id, row_number() OVER (ORDER BY sort_order, created_at) - 1 AS rn FROM public.pp_bom_items
              WHERE part_id = o.part_id AND parent_id IS NOT DISTINCT FROM o.parent_id)
  UPDATE public.pp_bom_items x SET sort_order = r.rn FROM r WHERE x.id = r.id;
  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id;
  SELECT * INTO s FROM public.pp_bom_items WHERE part_id = o.part_id AND parent_id IS NOT DISTINCT FROM o.parent_id AND sort_order = o.sort_order + sign(p_dir)::int;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.pp_bom_items SET sort_order = o.sort_order WHERE id = s.id;
  UPDATE public.pp_bom_items SET sort_order = s.sort_order WHERE id = o.id;
END;
$$;

-- import Excel rows into a part (new lines). Rows: level ("1", "1.1" …), part_no, description, material,
-- qty, unit, make_buy, vendor, unit_cost, status, remarks. p_replace clears the part's lines first.
CREATE OR REPLACE FUNCTION public.pp_bom_part_import(p_part_id uuid, p_rows jsonb, p_replace boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.pp_bom_parts%ROWTYPE; r jsonb; v_depth int; v_parents uuid[] := ARRAY[]::uuid[]; v_parent uuid; v_n int := 0;
  v_level text; v_base int; o public.pp_bom_items%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.pp_bom_parts WHERE id = p_part_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Part not found'; END IF;
  IF NOT public._pp_part_editable(p_part_id, auth.uid()) THEN RAISE EXCEPTION 'This part can no longer be changed'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN RAISE EXCEPTION 'No BOM lines found in the file'; END IF;
  IF p_replace THEN DELETE FROM public.pp_bom_items WHERE part_id = p_part_id; END IF;
  v_base := coalesce((SELECT max(sort_order) + 1 FROM public.pp_bom_items WHERE part_id = p_part_id AND parent_id IS NULL), 0);

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    CONTINUE WHEN nullif(trim(coalesce(r->>'description','')), '') IS NULL AND nullif(trim(coalesce(r->>'part_no','')), '') IS NULL;
    v_level := trim(coalesce(r->>'level', ''));
    v_depth := CASE WHEN v_level ~ '^\d+(\.\d+)*\.?$' THEN array_length(string_to_array(trim(trailing '.' from v_level), '.'), 1) ELSE 1 END;
    v_depth := least(v_depth, coalesce(array_length(v_parents, 1), 0) + 1);
    v_parent := CASE WHEN v_depth > 1 THEN v_parents[v_depth - 1] ELSE NULL END;
    o := NULL;
    o.id := gen_random_uuid(); o.project_id := b.project_id; o.part_id := p_part_id; o.parent_id := v_parent; o.action := 'add'; o.is_final := false;
    o.qty := 1; o.unit := 'Nos'; o.status := 'required';
    o := public._pp_bom_fields(o, (r - 'level') || jsonb_build_object('description', coalesce(nullif(trim(r->>'description'),''), trim(r->>'part_no'))));
    o.sort_order := CASE WHEN v_parent IS NULL THEN v_base + v_n ELSE v_n END;
    o.created_by := auth.uid(); o.created_at := clock_timestamp(); o.updated_at := now();
    INSERT INTO public.pp_bom_items SELECT o.*;
    v_parents := v_parents[1:v_depth - 1] || o.id;
    v_n := v_n + 1;
  END LOOP;
  UPDATE public.pp_bom_parts SET updated_at = now() WHERE id = p_part_id;
  PERFORM public._pp_bom_log(b.project_id, 'Imported ' || v_n || ' line(s) from Excel into BOM part "' || b.name || '"');
  RETURN v_n;
END;
$$;

-- procurement status of an approved line (no approval needed)
CREATE OR REPLACE FUNCTION public.pp_bom_final_status(p_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.pp_bom_items%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id AND is_final;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line not found'; END IF;
  IF NOT public._pp_can_manage(o.project_id, auth.uid()) THEN RAISE EXCEPTION 'Only the plan owner or an admin/manager can update the status'; END IF;
  IF p_status NOT IN ('required','ordered','received','issued') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  IF o.status = p_status THEN RETURN; END IF;
  UPDATE public.pp_bom_items SET status = p_status, updated_at = now() WHERE id = p_id;
  PERFORM public._pp_bom_log(o.project_id, 'Status of ' || coalesce(o.part_no || ' — ', '') || o.description || ': ' || initcap(p_status) || ' (was: ' || initcap(o.status) || ')');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pp_bom_part_create(uuid, text), public.pp_bom_part_rename(uuid, text), public.pp_bom_part_delete(uuid),
  public.pp_bom_part_submit(uuid, uuid, text), public.pp_bom_part_withdraw(uuid), public.pp_bom_part_decide(uuid, boolean, text),
  public.pp_bom_line_save(uuid, uuid, uuid, jsonb), public.pp_bom_line_delete(uuid), public.pp_bom_line_move(uuid, integer),
  public.pp_bom_part_import(uuid, jsonb, boolean), public.pp_bom_final_status(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pp_bom_part_create(uuid, text), public.pp_bom_part_rename(uuid, text), public.pp_bom_part_delete(uuid),
  public.pp_bom_part_submit(uuid, uuid, text), public.pp_bom_part_withdraw(uuid), public.pp_bom_part_decide(uuid, boolean, text),
  public.pp_bom_line_save(uuid, uuid, uuid, jsonb), public.pp_bom_line_delete(uuid), public.pp_bom_line_move(uuid, integer),
  public.pp_bom_part_import(uuid, jsonb, boolean), public.pp_bom_final_status(uuid, text) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pp_bom_parts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pp_bom_parts;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
