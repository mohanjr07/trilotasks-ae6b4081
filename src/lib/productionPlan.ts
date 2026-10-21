// ─────────────────────────────────────────────────────────────────────────────
//  Production Plan — shared types, states and data hooks.
//  Plans sit on top of the existing projects; tasks belong to a project.
//  All writes go through database functions (pp_save_plan, pp_save_task,
//  pp_move_task …) which also check who is allowed to do what.
// ─────────────────────────────────────────────────────────────────────────────
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PlanProject = { id: string; name: string; color: string | null; created_at: string | null };

export type Plan = {
  project_id: string;
  title: string | null;
  phase: string | null;
  plan_type: string | null;
  maturity: PlanState;
  owner_id: string | null;
  description: string | null;
  est_start: string | null;
  est_finish: string | null;
  actual_finish: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanTask = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: "Low" | "Medium" | "High" | "Critical";
  percent_complete: number;
  maturity: TaskState;
  owner_id: string | null;
  approver_id: string | null;
  est_start: string | null;
  est_finish: string | null;
  est_duration_days: number | null;
  actual_start: string | null;
  actual_finish: string | null;
  deliverables: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanApproval = {
  id: string; task_id: string; approver_id: string | null; requested_by: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  instructions: string | null; comment: string | null; requested_at: string; decided_at: string | null;
};

export type PlanHistory = {
  id: number; entity: "task" | "project"; entity_id: string; user_id: string | null;
  action: string; state: string | null; description: string | null; created_at: string;
};

export type TaskState = "draft" | "todo" | "in_work" | "in_approval" | "completed";
export type PlanState = TaskState;   // projects follow the same lifecycle as tasks

export const TASK_STATES: Array<{ key: TaskState; label: string }> = [
  { key: "draft", label: "Draft" },
  { key: "todo", label: "To Do" },
  { key: "in_work", label: "In Work" },
  { key: "in_approval", label: "In Approval" },
  { key: "completed", label: "Completed" },
];
export const PLAN_STATES = TASK_STATES;
export const stateLabel = (s?: string | null) =>
  TASK_STATES.find((x) => x.key === s)?.label ?? (s ?? "—");

export const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
export const PHASES = ["Concept", "Design", "Procurement", "Manufacturing", "Assembly", "Installation", "Commissioning", "Handover"];
export const PLAN_TYPES = ["Customer project", "Internal", "R&D", "Maintenance"];

export const isLead = (role?: string | null) => role === "admin" || role === "super_admin" || role === "manager";
export const isAdmin = (role?: string | null) => role === "admin" || role === "super_admin";

const DAY = 24 * 60 * 60 * 1000;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const parseDate = (s: string) => new Date(s + "T00:00:00");

/** Days late: past the estimated finish and not done (or finished after it). */
export function slipDays(t: Pick<PlanTask, "est_finish" | "actual_finish" | "maturity">): number {
  if (!t.est_finish) return 0;
  const due = parseDate(t.est_finish).getTime();
  const end = t.maturity === "completed" && t.actual_finish ? parseDate(t.actual_finish).getTime() : dayStart(new Date());
  return Math.max(0, Math.round((end - due) / DAY));
}

/** red = late, amber = due within 2 days, green = completed on time, grey = fine */
export function healthOf(t: Pick<PlanTask, "est_finish" | "actual_finish" | "maturity">): "late" | "soon" | "done" | "ok" {
  const slip = slipDays(t);
  if (t.maturity === "completed") return slip > 0 ? "late" : "done";
  if (slip > 0) return "late";
  if (t.est_finish && parseDate(t.est_finish).getTime() - dayStart(new Date()) <= 2 * DAY) return "soon";
  return "ok";
}
export const HEALTH_CLASS: Record<ReturnType<typeof healthOf>, string> = {
  late: "bg-red-600", soon: "bg-amber-500", done: "bg-green-600", ok: "bg-slate-300 dark:bg-slate-600",
};

export const fmtDate = (s?: string | null) =>
  s ? new Date(s.length <= 10 ? s + "T00:00:00" : s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

// ── data hooks ────────────────────────────────────────────────────────────────
const sb = supabase as any;

export function usePlanPeople() {
  const { data: people = [] } = useQuery({
    queryKey: ["pp-people"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_profiles");
      if (error) throw error;
      return ((data ?? []) as Array<{ id: string; full_name: string; role: string }>)
        .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
    },
  });
  const nameOf = (id?: string | null) => (id ? people.find((p) => p.id === id)?.full_name ?? "—" : "—");
  const approvers = people.filter((p) => isLead(p.role));
  return { people, nameOf, approvers };
}

export function usePlanProjects() {
  return useQuery({
    queryKey: ["pp-projects"],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const rpc = await sb.rpc("pp_projects");
      if (!rpc.error) return (rpc.data ?? []) as PlanProject[];
      const { data, error } = await supabase.from("projects").select("id, name, color, created_at").order("name");
      if (error) throw error;
      return (data ?? []) as PlanProject[];
    },
  });
}

export function usePlans() {
  return useQuery({
    queryKey: ["pp-plans"],
    queryFn: async () => {
      const { data, error } = await sb.from("pp_plans").select("*");
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });
}

export function usePlanTasks(projectId?: string) {
  return useQuery({
    queryKey: ["pp-tasks", projectId ?? "all"],
    queryFn: async () => {
      let q = sb.from("pp_tasks").select("*").order("est_start", { ascending: true, nullsFirst: false }).order("created_at");
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PlanTask[];
    },
  });
}

export function usePlanHistory(entity: "task" | "project", id?: string) {
  return useQuery({
    queryKey: ["pp-history", entity, id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await sb.from("pp_history").select("*").eq("entity", entity).eq("entity_id", id)
        .order("created_at", { ascending: true }).order("id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlanHistory[];
    },
  });
}

export function usePlanApprovals(taskId?: string) {
  return useQuery({
    queryKey: ["pp-approvals", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await sb.from("pp_approvals").select("*").eq("task_id", taskId).order("requested_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PlanApproval[];
    },
  });
}

/** Turns "relation does not exist" into a hint that the SQL has not been run yet. */
export function planError(e: any): string {
  const m = String(e?.message ?? e ?? "");
  if (/pp_|does not exist|schema cache/i.test(m) && /function|relation|table|schema/i.test(m))
    return "Production Plan is not set up in the database yet — run the Production Plan SQL first.";
  return m || "Something went wrong";
}
