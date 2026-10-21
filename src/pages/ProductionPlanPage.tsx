// ─────────────────────────────────────────────────────────────────────────────
//  Production Plan — Projects and Tasks lists.
//  Projects: plans on top of the existing projects (anyone can start one).
//  Tasks:    tasks of those projects; click one to open Properties / Lifecycle / History.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarRange, Plus, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PlanDialog, TaskDialog, ProgressBar } from "@/components/ProductionPlanParts";
import {
  usePlanPeople, usePlanProjects, usePlans, usePlanTasks, slipDays, healthOf, HEALTH_CLASS, stateLabel, fmtDate, isLead,
} from "@/lib/productionPlan";

type Tab = "projects" | "tasks";

export default function ProductionPlanPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "tasks" ? "tasks" : "projects";
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });

  return (
    <AnimatedPage>
      <div className="mb-5">
        <h1 className="font-heading text-xl sm:text-[28px] font-bold text-ink-primary">Production Plan</h1>
        <p className="text-sm text-ink-muted mt-0.5">Plan each project, split it into tasks and follow every task from Draft to Completed. You see the plans you are part of.</p>
      </div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {([["projects", "Projects"], ["tasks", "Tasks"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px", tab === k ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink-secondary")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "projects" ? <ProjectsTab /> : <TasksTab />}
    </AnimatedPage>
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────
function ProjectsTab() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const lead = isLead(profile?.role);   // only admins / managers create plans
  const { nameOf } = usePlanPeople();
  const { data: projects = [] } = usePlanProjects();
  const { data: plans = [], isLoading, error } = usePlans();
  const { data: tasks = [] } = usePlanTasks();
  const [filter, setFilter] = useState<"assigned" | "active" | "all">("assigned");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => plans.map((pl) => {
    const project = projects.find((p) => p.id === pl.project_id);
    const ts = tasks.filter((t) => t.project_id === pl.project_id);
    const avg = ts.length ? ts.reduce((s, t) => s + Number(t.percent_complete || 0), 0) / ts.length : 0;
    return { pl, name: project?.name ?? "—", ts, avg, done: ts.filter((t) => t.maturity === "completed").length };
  }).filter((r) => {
    if (filter !== "all" && r.pl.maturity === "completed") return false;
    if (filter === "assigned" && !(r.pl.owner_id === user?.id || r.pl.created_by === user?.id || r.ts.some((t) => t.owner_id === user?.id))) return false;
    const k = q.trim().toLowerCase();
    return !k || `${r.name} ${r.pl.title ?? ""} ${r.pl.phase ?? ""} ${nameOf(r.pl.owner_id)}`.toLowerCase().includes(k);
  }).sort((a, b) => a.name.localeCompare(b.name)), [plans, projects, tasks, filter, q, user?.id, nameOf]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="assigned">Filter: Assigned active</option>
            <option value="active">Filter: All active</option>
            <option value="all">Filter: All</option>
          </select>
          <div className="relative sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" className="h-9 pl-9" />
          </div>
        </div>
        {lead && <Button className="gap-1.5" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New plan</Button>}
      </div>

      {error ? (
        <EmptyState icon={CalendarRange} title="Production Plan is not set up yet" description="Run the Production Plan SQL in Supabase, then reload." />
      ) : isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarRange} title="No Objects Found"
          description={!lead ? "Plans you are part of (as plan owner or task owner) will show here." : filter === "assigned" ? "No active plans you own or have tasks in. Switch the filter to see all plans, or create one." : "Click “New plan” to plan a project."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-muted/50 text-left text-ink-secondary">
              <tr>
                {["Name", "Status", "Title", "Current Phase", "Type", "Owner", "Tasks", "Progress", "Estimated Finish", "Actual Finish", "Originated"].map((h) =>
                  <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pl.project_id} onClick={() => navigate(`/production-plan/project/${r.pl.project_id}`)}
                  className="cursor-pointer border-t border-border hover:bg-muted/40">
                  <td className="px-3 py-2.5 font-medium text-primary">{r.name}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{stateLabel(r.pl.maturity)}</td>
                  <td className="px-3 py-2.5 max-w-[220px] truncate">{r.pl.title ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.pl.phase ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.pl.plan_type ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{nameOf(r.pl.owner_id)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{r.done}/{r.ts.length}</td>
                  <td className="px-3 py-2.5"><ProgressBar value={r.avg} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(r.pl.est_finish)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(r.pl.actual_finish)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(r.pl.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PlanDialog open={creating} onClose={() => setCreating(false)} onSaved={(pid) => navigate(`/production-plan/project/${pid}`)} />
    </>
  );
}

// ── Tasks ────────────────────────────────────────────────────────────────────
function TasksTab() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { nameOf } = usePlanPeople();
  const { data: projects = [] } = usePlanProjects();
  const { data: plans = [] } = usePlans();
  const { data: tasks = [], isLoading, error } = usePlanTasks();
  const [filter, setFilter] = useState<"assigned" | "approval" | "open" | "all">("assigned");
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const canAdd = isLead(profile?.role) || plans.some((pl) => pl.owner_id === user?.id);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "—";
  const waitingForMe = tasks.filter((t) => t.maturity === "in_approval" && t.approver_id === user?.id).length;

  const rows = tasks.filter((t) => {
    if (filter === "assigned" && !(t.owner_id === user?.id && t.maturity !== "completed")) return false;
    if (filter === "approval" && !(t.maturity === "in_approval" && t.approver_id === user?.id)) return false;
    if (filter === "open" && t.maturity === "completed") return false;
    if (projectId && t.project_id !== projectId) return false;
    const k = q.trim().toLowerCase();
    return !k || `${t.title} ${projectName(t.project_id)} ${nameOf(t.owner_id)}`.toLowerCase().includes(k);
  });

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="assigned">Filter: Assigned tasks</option>
            <option value="approval">Filter: Waiting for my approval{waitingForMe ? ` (${waitingForMe})` : ""}</option>
            <option value="open">Filter: All open</option>
            <option value="all">Filter: All</option>
          </select>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 max-w-[240px] rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All projects</option>
            {projects.filter((p) => plans.some((pl) => pl.project_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="relative sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="h-9 pl-9" />
          </div>
        </div>
        {canAdd && <Button className="gap-1.5" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New task</Button>}
      </div>

      {error ? (
        <EmptyState icon={CalendarRange} title="Production Plan is not set up yet" description="Run the Production Plan SQL in Supabase, then reload." />
      ) : isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarRange} title="No Objects Found"
          description={filter === "assigned" ? "No open tasks assigned to you. Switch the filter to see other tasks." : "Tasks added to the plans will show here."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/50 text-left text-ink-secondary">
              <tr>
                <th className="px-3 py-2.5 font-medium">Title</th>
                <th className="px-2 py-2.5 font-medium" aria-label="Health" />
                {["Slip Days", "Maturity", "% Complete", "Project", "Owner", "Priority", "Est Start", "Est Finish"].map((h) =>
                  <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const slip = slipDays(t);
                return (
                  <tr key={t.id} onClick={() => navigate(`/production-plan/task/${t.id}`)} className="cursor-pointer border-t border-border hover:bg-muted/40">
                    <td className="px-3 py-2.5 font-medium text-primary max-w-[260px] truncate">{t.title}</td>
                    <td className="px-2 py-2.5"><span className={cn("inline-block h-3 w-3 rounded-sm", HEALTH_CLASS[healthOf(t)])} /></td>
                    <td className={cn("px-3 py-2.5 tabular-nums", slip > 0 && "font-semibold text-red-600")}>{slip}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{stateLabel(t.maturity)}</td>
                    <td className="px-3 py-2.5"><ProgressBar value={t.percent_complete} /></td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate">{projectName(t.project_id)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{nameOf(t.owner_id)}</td>
                    <td className="px-3 py-2.5">{t.priority}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(t.est_start)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(t.est_finish)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <TaskDialog open={creating} onClose={() => setCreating(false)} defaultProjectId={projectId || undefined}
        onSaved={(id) => navigate(`/production-plan/task/${id}`)} />
    </>
  );
}
