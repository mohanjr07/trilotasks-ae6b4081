-- Organisation Flow: a node can also report to other nodes (drawn as an extra connector line)
ALTER TABLE public.organisation_flow_nodes
  ADD COLUMN IF NOT EXISTS extra_parent_ids uuid[] NOT NULL DEFAULT '{}';
