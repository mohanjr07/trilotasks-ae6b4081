-- Reference-number pickers: every running number issued on any form
-- (old "Use This" opens + digital requests), newest first.
CREATE OR REPLACE FUNCTION public.form_refs()
RETURNS TABLE(reference_value text, form_title text, project text, issued_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.reference_value,
         f.title,
         (SELECT coalesce(fr.data->'fields'->>'project', fr.data->'fields'->>'project_name', fr.data->'fields'->>'project_title')
            FROM public.form_requests fr
           WHERE fr.form_id = f.id AND fr.reference_value = o.reference_value LIMIT 1) AS project,
         o.opened_at
  FROM public.production_form_opens o
  JOIN public.production_forms f ON f.id = o.form_id
  WHERE coalesce(o.reference_value, '') <> ''
  ORDER BY o.opened_at DESC
  LIMIT 1000;
$$;
REVOKE EXECUTE ON FUNCTION public.form_refs() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.form_refs() TO authenticated;
