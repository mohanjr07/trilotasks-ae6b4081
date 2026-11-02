-- Forms grouped by project: every form request gets a project_id.
-- Set from the project picked in the form (data.project_id), otherwise matched by name
-- from the form's own Project / Project Name / Project Title field.
ALTER TABLE public.form_requests ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS form_requests_project_idx ON public.form_requests (project_id);

CREATE OR REPLACE FUNCTION public._form_project_from_data(p_data jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text;
BEGIN
  IF coalesce(p_data->>'project_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN
    SELECT id INTO v_id FROM public.projects WHERE id = (p_data->>'project_id')::uuid;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  v_name := nullif(trim(coalesce(p_data->'fields'->>'project', p_data->'fields'->>'project_name', p_data->'fields'->>'project_title', '')), '');
  IF v_name IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.projects WHERE lower(trim(name)) = lower(v_name) LIMIT 1;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._form_set_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.project_id := public._form_project_from_data(NEW.data);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_form_set_project ON public.form_requests;
CREATE TRIGGER trg_form_set_project BEFORE INSERT OR UPDATE OF data ON public.form_requests
  FOR EACH ROW EXECUTE FUNCTION public._form_set_project();

-- existing forms
UPDATE public.form_requests SET project_id = public._form_project_from_data(data) WHERE project_id IS NULL;

NOTIFY pgrst, 'reload schema';
