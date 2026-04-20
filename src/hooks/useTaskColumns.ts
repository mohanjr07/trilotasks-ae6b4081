import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TaskColumn = {
  id?: string;
  key: string;
  label: string;
  color: string;
  position: number;
  is_default: boolean;
};

// Hardcoded fallback used when the task_columns table hasn't been created yet.
// The `key` values here must match the legacy tasks.status values.
export const DEFAULT_TASK_COLUMNS: TaskColumn[] = [
  { key: "todo",        label: "To Do",       color: "#6366f1", position: 0, is_default: true },
  { key: "in_progress", label: "In Progress", color: "#f59e0b", position: 1, is_default: true },
  { key: "on_hold",     label: "On Hold",     color: "#ef4444", position: 2, is_default: true },
  { key: "completed",   label: "Completed",   color: "#10b981", position: 3, is_default: true },
];

export function useTaskColumns() {
  return useQuery({
    queryKey: ["task-columns"],
    queryFn: async (): Promise<TaskColumn[]> => {
      const { data, error } = await supabase
        .from("task_columns")
        .select("id, key, label, color, position, is_default")
        .order("position", { ascending: true });
      // Table may not exist yet (migration not run). Fall back silently.
      if (error || !data || data.length === 0) return DEFAULT_TASK_COLUMNS;
      return data as TaskColumn[];
    },
    staleTime: 30_000,
  });
}

/**
 * Look up the display config (label + color) for a status key. Falls back
 * gracefully when the key isn't known (e.g. a column was deleted but tasks
 * still reference it).
 */
export function getColumnConfig(columns: TaskColumn[], key: string): TaskColumn {
  return (
    columns.find((c) => c.key === key) ??
    DEFAULT_TASK_COLUMNS.find((c) => c.key === key) ?? {
      key,
      label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      color: "#94a3b8",
      position: 999,
      is_default: false,
    }
  );
}
