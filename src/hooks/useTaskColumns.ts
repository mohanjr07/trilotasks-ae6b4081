import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type TaskColumn = {
  id?: string;
  key: string;
  label: string;        // already merged with the current user's override
  baseLabel?: string;   // the global label from task_columns (what everyone else sees)
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
  const { user } = useAuth();

  return useQuery({
    // Include user.id so the cache is per-user (preferences are personal)
    queryKey: ["task-columns", user?.id ?? "anon"],
    queryFn: async (): Promise<TaskColumn[]> => {
      // 1. Base columns — global list shared by everyone
      const { data: base, error: baseErr } = await supabase
        .from("task_columns")
        .select("id, key, label, color, position, is_default")
        .order("position", { ascending: true });

      const baseColumns: TaskColumn[] =
        baseErr || !base || base.length === 0
          ? DEFAULT_TASK_COLUMNS
          : (base as TaskColumn[]);

      if (!user?.id) {
        return baseColumns.map((c) => ({ ...c, baseLabel: c.label }));
      }

      // 2. Personal overrides — each user can rename any column for themselves
      const { data: prefs, error: prefsErr } = await supabase
        .from("user_task_column_prefs")
        .select("column_key, custom_label")
        .eq("user_id", user.id);

      // If the prefs table doesn't exist yet (migration not run) just return
      // the base columns unchanged.
      if (prefsErr || !prefs) {
        return baseColumns.map((c) => ({ ...c, baseLabel: c.label }));
      }

      const prefMap = new Map<string, string>(
        prefs.map((p: any) => [p.column_key, p.custom_label])
      );

      return baseColumns.map((c) => ({
        ...c,
        baseLabel: c.label,
        label: prefMap.get(c.key) ?? c.label,
      }));
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
