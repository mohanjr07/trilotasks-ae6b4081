-- ─────────────────────────────────────────────────────────────────────────────
--  Production Plan — BOM (multi-level bill of materials) per project.
--  Everyone signed in can read; the plan owner or an admin/manager edits.
--  Every change is written to the project's History.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pp_bom_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES public.pp_bom_items(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  part_no     text,
  description text NOT NULL,
  material    text,
  qty         numeric NOT NULL DEFAULT 1 CHECK (qty >= 0),
  unit        text NOT NULL DEFAULT 'Nos',
  make_buy    text CHECK (make_buy IN ('Make','Buy')),
  vendor      text,
  unit_cost   numeric CHECK (unit_cost IS NULL OR unit_cost >= 0),
  status      text NOT NULL DEFAULT 'required' CHECK (status IN ('required','ordered','received','issued')),
  remarks     text,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pp_bom_project_idx ON public.pp_bom_items (project_id, parent_id, sort_order);

ALTER TABLE public.pp_bom_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pp_bom_read ON public.pp_bom_items;
CREATE POLICY pp_bom_read ON public.pp_bom_items FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.pp_bom_items FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pp_bom_items FROM authenticated;
GRANT SELECT ON public.pp_bom_items TO authenticated;

CREATE OR REPLACE FUNCTION public._pp_bom_log(p_project uuid, p_text text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.pp_history (entity, entity_id, user_id, action, state, description)
  VALUES ('project', p_project, auth.uid(), 'BOM',
          public._pp_state_label((SELECT maturity FROM public.pp_plans WHERE project_id = p_project)), p_text)
$$;
REVOKE EXECUTE ON FUNCTION public._pp_bom_log(uuid, text) FROM anon, authenticated, public;

-- add (p_id NULL) or change one line
CREATE OR REPLACE FUNCTION public.pp_bom_save(p_id uuid, p_project_id uuid, p_parent_id uuid, p_fields jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid(); f jsonb := coalesce(p_fields, '{}'::jsonb); o public.pp_bom_items%ROWTYPE; n public.pp_bom_items%ROWTYPE;
  v_id uuid; v_changes text := ''; k text; v_old text; v_new text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF f ? 'make_buy' AND nullif(f->>'make_buy','') IS NOT NULL AND f->>'make_buy' NOT IN ('Make','Buy') THEN RAISE EXCEPTION 'Make/Buy must be Make or Buy'; END IF;

  IF p_id IS NULL THEN
    IF p_project_id IS NULL THEN RAISE EXCEPTION 'Project missing'; END IF;
    IF NOT public._pp_can_manage(p_project_id, v_me) THEN RAISE EXCEPTION 'Only the plan owner or an admin/manager can edit the BOM'; END IF;
    IF nullif(trim(coalesce(f->>'description','')), '') IS NULL THEN RAISE EXCEPTION 'Enter a description'; END IF;
    IF p_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pp_bom_items WHERE id = p_parent_id AND project_id = p_project_id) THEN
      RAISE EXCEPTION 'Parent line not found';
    END IF;
    INSERT INTO public.pp_plans (project_id, owner_id, created_by) VALUES (p_project_id, v_me, v_me) ON CONFLICT (project_id) DO NOTHING;
    INSERT INTO public.pp_bom_items (project_id, parent_id, sort_order, part_no, description, material, qty, unit, make_buy, vendor, unit_cost, status, remarks, created_by)
    VALUES (p_project_id, p_parent_id,
            coalesce((SELECT max(sort_order) + 1 FROM public.pp_bom_items WHERE project_id = p_project_id AND parent_id IS NOT DISTINCT FROM p_parent_id), 0),
            nullif(trim(f->>'part_no'),''), trim(f->>'description'), nullif(trim(f->>'material'),''),
            coalesce(nullif(f->>'qty','')::numeric, 1), coalesce(nullif(trim(f->>'unit'),''), 'Nos'),
            nullif(f->>'make_buy',''), nullif(trim(f->>'vendor'),''), nullif(f->>'unit_cost','')::numeric,
            coalesce(nullif(f->>'status',''), 'required'), nullif(trim(f->>'remarks'),''), v_me)
    RETURNING id INTO v_id;
    PERFORM public._pp_bom_log(p_project_id, 'Added ' || coalesce(nullif(trim(f->>'part_no'),'') || ' — ', '') || trim(f->>'description')
      || ' (qty ' || coalesce(nullif(f->>'qty',''), '1') || ')');
    RETURN v_id;
  END IF;

  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOM line not found'; END IF;
  IF NOT public._pp_can_manage(o.project_id, v_me) THEN RAISE EXCEPTION 'Only the plan owner or an admin/manager can edit the BOM'; END IF;
  IF f ? 'description' AND nullif(trim(coalesce(f->>'description','')), '') IS NULL THEN RAISE EXCEPTION 'Enter a description'; END IF;

  UPDATE public.pp_bom_items SET
    part_no     = CASE WHEN f ? 'part_no'     THEN nullif(trim(f->>'part_no'),'') ELSE part_no END,
    description = CASE WHEN f ? 'description' THEN trim(f->>'description') ELSE description END,
    material    = CASE WHEN f ? 'material'    THEN nullif(trim(f->>'material'),'') ELSE material END,
    qty         = CASE WHEN f ? 'qty'         THEN coalesce(nullif(f->>'qty','')::numeric, 0) ELSE qty END,
    unit        = CASE WHEN f ? 'unit'        THEN coalesce(nullif(trim(f->>'unit'),''), 'Nos') ELSE unit END,
    make_buy    = CASE WHEN f ? 'make_buy'    THEN nullif(f->>'make_buy','') ELSE make_buy END,
    vendor      = CASE WHEN f ? 'vendor'      THEN nullif(trim(f->>'vendor'),'') ELSE vendor END,
    unit_cost   = CASE WHEN f ? 'unit_cost'   THEN nullif(f->>'unit_cost','')::numeric ELSE unit_cost END,
    status      = CASE WHEN f ? 'status'      THEN coalesce(nullif(f->>'status',''), 'required') ELSE status END,
    remarks     = CASE WHEN f ? 'remarks'     THEN nullif(trim(f->>'remarks'),'') ELSE remarks END,
    updated_at  = now()
  WHERE id = p_id RETURNING * INTO n;

  FOREACH k IN ARRAY ARRAY['part_no','description','material','qty','unit','make_buy','vendor','unit_cost','status','remarks'] LOOP
    v_old := to_jsonb(o)->>k; v_new := to_jsonb(n)->>k;
    IF v_old IS DISTINCT FROM v_new THEN
      v_changes := v_changes || CASE WHEN v_changes = '' THEN '' ELSE '; ' END
        || CASE k WHEN 'part_no' THEN 'Part no.' WHEN 'description' THEN 'Description' WHEN 'material' THEN 'Material'
                  WHEN 'qty' THEN 'Qty' WHEN 'unit' THEN 'Unit' WHEN 'make_buy' THEN 'Make/Buy' WHEN 'vendor' THEN 'Vendor'
                  WHEN 'unit_cost' THEN 'Unit cost' WHEN 'status' THEN 'Status' ELSE 'Remarks' END
        || ': ' || coalesce(v_new, '—') || ' (was: ' || coalesce(v_old, '—') || ')';
    END IF;
  END LOOP;
  IF v_changes <> '' THEN
    PERFORM public._pp_bom_log(o.project_id, 'Changed ' || coalesce(n.part_no || ' — ', '') || n.description || ': ' || v_changes);
  END IF;
  RETURN p_id;
END;
$$;

-- delete a line (and everything under it)
CREATE OR REPLACE FUNCTION public.pp_bom_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.pp_bom_items%ROWTYPE; v_n int;
BEGIN
  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOM line not found'; END IF;
  IF NOT public._pp_can_manage(o.project_id, auth.uid()) THEN RAISE EXCEPTION 'Only the plan owner or an admin/manager can edit the BOM'; END IF;
  WITH RECURSIVE sub AS (SELECT id FROM public.pp_bom_items WHERE parent_id = p_id
                         UNION ALL SELECT b.id FROM public.pp_bom_items b JOIN sub ON b.parent_id = sub.id)
  SELECT count(*) INTO v_n FROM sub;
  DELETE FROM public.pp_bom_items WHERE id = p_id;
  PERFORM public._pp_bom_log(o.project_id, 'Deleted ' || coalesce(o.part_no || ' — ', '') || o.description
    || CASE WHEN v_n > 0 THEN ' and ' || v_n || ' line(s) under it' ELSE '' END);
END;
$$;

-- move a line up (-1) or down (+1) among its siblings
CREATE OR REPLACE FUNCTION public.pp_bom_move(p_id uuid, p_dir integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.pp_bom_items%ROWTYPE; s public.pp_bom_items%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOM line not found'; END IF;
  IF NOT public._pp_can_manage(o.project_id, auth.uid()) THEN RAISE EXCEPTION 'Only the plan owner or an admin/manager can edit the BOM'; END IF;
  -- tidy the sibling order first (0,1,2,…)
  WITH r AS (SELECT id, row_number() OVER (ORDER BY sort_order, created_at) - 1 AS rn FROM public.pp_bom_items
              WHERE project_id = o.project_id AND parent_id IS NOT DISTINCT FROM o.parent_id)
  UPDATE public.pp_bom_items b SET sort_order = r.rn FROM r WHERE b.id = r.id;
  SELECT * INTO o FROM public.pp_bom_items WHERE id = p_id;
  SELECT * INTO s FROM public.pp_bom_items
   WHERE project_id = o.project_id AND parent_id IS NOT DISTINCT FROM o.parent_id AND sort_order = o.sort_order + sign(p_dir)::int;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.pp_bom_items SET sort_order = o.sort_order WHERE id = s.id;
  UPDATE public.pp_bom_items SET sort_order = s.sort_order WHERE id = o.id;
END;
$$;

-- import many lines from Excel. Each row: level ("1", "1.1", "1.1.2" …), part_no, description, material,
-- qty, unit, make_buy, vendor, unit_cost, status, remarks. p_replace = true clears the old BOM first.
CREATE OR REPLACE FUNCTION public.pp_bom_import(p_project_id uuid, p_rows jsonb, p_replace boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid(); r jsonb; v_depth int; v_parents uuid[] := ARRAY[]::uuid[]; v_parent uuid; v_id uuid; v_n int := 0;
  v_level text; v_status text; v_mb text; v_base int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF NOT public._pp_can_manage(p_project_id, v_me) THEN RAISE EXCEPTION 'Only the plan owner or an admin/manager can edit the BOM'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN RAISE EXCEPTION 'No BOM lines found in the file'; END IF;
  INSERT INTO public.pp_plans (project_id, owner_id, created_by) VALUES (p_project_id, v_me, v_me) ON CONFLICT (project_id) DO NOTHING;
  IF p_replace THEN DELETE FROM public.pp_bom_items WHERE project_id = p_project_id; END IF;
  v_base := coalesce((SELECT max(sort_order) + 1 FROM public.pp_bom_items WHERE project_id = p_project_id AND parent_id IS NULL), 0);

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    CONTINUE WHEN nullif(trim(coalesce(r->>'description','')), '') IS NULL AND nullif(trim(coalesce(r->>'part_no','')), '') IS NULL;
    v_level := trim(coalesce(r->>'level', ''));
    v_depth := CASE WHEN v_level ~ '^\d+(\.\d+)*\.?$' THEN array_length(string_to_array(trim(trailing '.' from v_level), '.'), 1) ELSE 1 END;
    v_depth := least(v_depth, coalesce(array_length(v_parents, 1), 0) + 1);   -- never skip a level
    v_parent := CASE WHEN v_depth > 1 THEN v_parents[v_depth - 1] ELSE NULL END;
    v_status := lower(trim(coalesce(r->>'status','')));
    v_status := CASE WHEN v_status IN ('required','ordered','received','issued') THEN v_status ELSE 'required' END;
    v_mb := initcap(trim(coalesce(r->>'make_buy','')));
    v_mb := CASE WHEN v_mb IN ('Make','Buy') THEN v_mb ELSE NULL END;
    INSERT INTO public.pp_bom_items (project_id, parent_id, sort_order, part_no, description, material, qty, unit, make_buy, vendor, unit_cost, status, remarks, created_by)
    VALUES (p_project_id, v_parent, CASE WHEN v_parent IS NULL THEN v_base + v_n ELSE v_n END,
            nullif(trim(r->>'part_no'),''), coalesce(nullif(trim(r->>'description'),''), trim(r->>'part_no')), nullif(trim(r->>'material'),''),
            coalesce(nullif(regexp_replace(coalesce(r->>'qty',''), '[^0-9.]', '', 'g'), '')::numeric, 1),
            coalesce(nullif(trim(r->>'unit'),''), 'Nos'), v_mb, nullif(trim(r->>'vendor'),''),
            nullif(regexp_replace(coalesce(r->>'unit_cost',''), '[^0-9.]', '', 'g'), '')::numeric,
            v_status, nullif(trim(r->>'remarks'),''), v_me)
    RETURNING id INTO v_id;
    v_parents := v_parents[1:v_depth - 1] || v_id;
    v_n := v_n + 1;
  END LOOP;
  PERFORM public._pp_bom_log(p_project_id, CASE WHEN p_replace THEN 'Replaced the BOM — imported ' ELSE 'Imported ' END || v_n || ' line(s) from Excel');
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pp_bom_save(uuid, uuid, uuid, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pp_bom_delete(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pp_bom_move(uuid, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pp_bom_import(uuid, jsonb, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.pp_bom_save(uuid, uuid, uuid, jsonb), public.pp_bom_delete(uuid),
  public.pp_bom_move(uuid, integer), public.pp_bom_import(uuid, jsonb, boolean) TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pp_bom_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pp_bom_items;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
