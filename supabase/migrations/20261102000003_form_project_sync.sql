-- Sync every form into its project.
-- 1) Smarter matching of the form's Project / Project Name / Project Title text to a project:
--    ignores case, spaces and punctuation ("Coldstar_PUNE - G+2" = "coldstar pune g2"), and
--    accepts the text containing the project name or the other way round (longest name wins).
-- 2) A project set by hand is kept when the form is edited later.
-- 3) Admins (or the person who filled it) can set / change a form's project: set_form_project().
CREATE OR REPLACE FUNCTION public._norm_name(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]', '', 'g') $$;

CREATE OR REPLACE FUNCTION public._form_project_from_data(p_data jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text; v_norm text;
BEGIN
  IF coalesce(p_data->>'project_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN
    SELECT id INTO v_id FROM public.projects WHERE id = (p_data->>'project_id')::uuid;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  v_name := nullif(trim(coalesce(nullif(p_data->'fields'->>'project', ''), nullif(p_data->'fields'->>'project_name', ''),
                                 nullif(p_data->'fields'->>'project_title', ''), '')), '');
  IF v_name IS NULL THEN RETURN NULL; END IF;
  v_norm := public._norm_name(v_name);
  IF length(v_norm) < 3 THEN RETURN NULL; END IF;
  -- same name (ignoring case / spaces / punctuation)
  SELECT id INTO v_id FROM public.projects WHERE public._norm_name(name) = v_norm LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  -- one contains the other (at least 4 letters), longest project name wins
  SELECT id INTO v_id FROM public.projects
   WHERE length(public._norm_name(name)) >= 4
     AND (v_norm LIKE '%' || public._norm_name(name) || '%' OR (length(v_norm) >= 4 AND public._norm_name(name) LIKE '%' || v_norm || '%'))
   ORDER BY length(public._norm_name(name)) DESC LIMIT 1;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._form_set_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.project_id := coalesce(public._form_project_from_data(NEW.data), CASE WHEN TG_OP = 'UPDATE' THEN OLD.project_id END);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_form_set_project ON public.form_requests;
CREATE TRIGGER trg_form_set_project BEFORE INSERT OR UPDATE OF data ON public.form_requests
  FOR EACH ROW EXECUTE FUNCTION public._form_set_project();

CREATE OR REPLACE FUNCTION public.set_form_project(p_id uuid, p_project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.form_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.form_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Form not found'; END IF;
  IF NOT (r.requested_by = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'))) THEN
    RAISE EXCEPTION 'Only an admin or the person who filled the form can change its project';
  END IF;
  IF p_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project) THEN RAISE EXCEPTION 'Project not found'; END IF;
  -- keep it in the form data too, so a later edit keeps the project
  UPDATE public.form_requests
     SET data = CASE WHEN p_project IS NULL THEN data - 'project_id' ELSE jsonb_set(coalesce(data, '{}'::jsonb), '{project_id}', to_jsonb(p_project::text)) END,
         updated_at = now()
   WHERE id = p_id;
  UPDATE public.form_requests SET project_id = p_project WHERE id = p_id;   -- also clears a name match when "No project" is chosen
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_form_project(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_form_project(uuid, uuid) TO authenticated;

-- sync all existing forms
UPDATE public.form_requests SET project_id = public._form_project_from_data(data) WHERE project_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- What was synced, and what still needs a project (set it from the form in My Forms & Approvals)
SELECT coalesce(p.name, '— no project —') AS project, count(*) AS forms,
       string_agg(DISTINCT coalesce(nullif(f.data->'fields'->>'project',''), f.data->'fields'->>'project_name', f.data->'fields'->>'project_title', '(blank)'), ' | ')
         FILTER (WHERE p.id IS NULL) AS unmatched_project_text
  FROM public.form_requests f LEFT JOIN public.projects p ON p.id = f.project_id
 GROUP BY p.name ORDER BY (p.name IS NULL), p.name;
