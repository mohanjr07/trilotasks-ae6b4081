// ─────────────────────────────────────────────────────────────────────────────
//  Production Plan — one task or one project:
//  header, then Properties / (Tasks) / Lifecycle / History tabs.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2, Plus, Check, Undo2, ChevronUp, ChevronDown, RotateCcw, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PlanDialog, TaskDialog, MoveDialog, LifecycleChain, MaturityChips, PropertiesTable, HistoryTable, ProgressBar, useInvalidatePlan,
} from "@/components/ProductionPlanParts";
import {
  TASK_STATES, PLAN_STATES, usePlanPeople, usePlanProjects, usePlans, usePlanTasks, usePlanHistory, usePlanApprovals,
  slipDays, healthOf, HEALTH_CLASS, stateLabel, fmtDate, fmtDateTime, isLead, isAdmin, planError, type TaskState,
} from "@/lib/productionPlan";

const sb = supabase as any;

function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<[T, string]> }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {items.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap", value === k ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink-secondary")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Header({ back, backLabel, kind, title, subtitle, description, chips, owner, modified, actions }: {
  back: string; backLabel: string; kind: string; title: string; subtitle?: string; description?: string | null;
  chips: React.ReactNode; owner: string; modified: string; actions?: React.ReactNode;
}) {
  return (
    <>
      <Link to={back} className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Link>
      <div className="mb-5 grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">{kind}</p>
          <h1 className="font-heading text-lg sm:text-xl font-bold text-ink-primary break-words">{title}</h1>
          {subtitle && <p className="text-sm text-ink-secondary truncate">{subtitle}</p>}
        </div>
        <div className="min-w-0 text-sm text-ink-secondary whitespace-pre-line line-clamp-3 md:border-l md:border-border md:pl-4">
          {description || <span className="text-ink-muted">No description</span>}
        </div>
        <div className="space-y-1.5 text-sm md:border-l md:border-border md:pl-4">
          <div className="flex items-center gap-2"><span className="text-ink-muted">Maturity State:</span>{chips}</div>
          <p><span className="text-ink-muted">Owner:</span> {owner}</p>
          <p><span className="text-ink-muted">Modified:</span> {modified}</p>
          {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
        </div>
      </div>
    </>
  );
}

// ── Task ─────────────────────────────────────────────────────────────────────
export function PlanTaskPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { nameOf } = usePlanPeople();
  const { data: projects = [] } = usePlanProjects();
  const { data: plans = [] } = usePlans();
  const { data: tasks = [], isLoading } = usePlanTasks();
  const task = tasks.find((t) => t.id === id) ?? null;
  const { data: history = [] } = usePlanHistory("task", id);
  const { data: approvals = [] } = usePlanApprovals(id);
  const invalidate = useInvalidatePlan();
  const [tab, setTab] = useState<"properties" | "lifecycle" | "history">("properties");
  const [editing, setEditing] = useState(false);
  const [move, setMove] = useState<null | { to: TaskState; title: string; label: string; approver?: boolean; comment?: boolean }>(null);
  const [pct, setPct] = useState<string | null>(null);

  const plan = plans.find((p) => p.project_id === task?.project_id);
  const canManage = isLead(profile?.role) || (!!plan && (plan.owner_id === user?.id || plan.created_by === user?.id));
  const isOwner = !!task && task.owner_id === user?.id;
  const isDecider = !!task && (task.approver_id === user?.id || isAdmin(profile?.role));

  const moveTask = useMutation({
    mutationFn: async (a: { to: TaskState; approver?: string | null; comment?: string }) => {
      const { error } = await sb.rpc("pp_move_task", { p_id: id, p_to: a.to, p_approver: a.approver ?? null, p_comment: a.comment || null });
      if (error) throw error;
      return a.to;
    },
    onSuccess: (to) => { invalidate(); setMove(null); toast.success(`Moved to ${stateLabel(to)}`); },
    onError: (e) => toast.error(planError(e)),
  });
  const savePct = useMutation({
    mutationFn: async (v: string) => {
      const { error } = await sb.rpc("pp_save_task", { p_id: id, p_project_id: null, p_fields: { percent_complete: v } });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setPct(null); toast.success("% complete updated"); },
    onError: (e) => toast.error(planError(e)),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await sb.rpc("pp_delete_task", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Task deleted"); navigate("/production-plan?tab=tasks"); },
    onError: (e) => toast.error(planError(e)),
  });

  if (isLoading) return <AnimatedPage><div className="h-48 rounded-xl bg-muted animate-pulse" /></AnimatedPage>;
  if (!task) return (
    <AnimatedPage>
      <EmptyState icon={ClipboardList} title="Task not found" description="It may have been deleted." />
      <div className="mt-4 text-center"><Link to="/production-plan?tab=tasks" className="text-primary text-sm">Back to tasks</Link></div>
    </AnimatedPage>
  );

  const projectName = projects.find((p) => p.id === task.project_id)?.name ?? "—";
  const idx = TASK_STATES.findIndex((s) => s.key === task.maturity);
  const prev = TASK_STATES[idx - 1], next = TASK_STATES[idx + 1];
  const canMove = isOwner || canManage;
  const slip = slipDays(task);

  const lifecycleActions = (
    <div className="flex flex-wrap justify-center gap-2">
      {["draft", "todo", "in_work"].includes(task.maturity) && canMove && (
        <>
          {prev && <Button variant="outline" className="gap-1.5" disabled={moveTask.isPending}
            onClick={() => moveTask.mutate({ to: prev.key })}><ChevronDown className="h-4 w-4" /> Demote to {prev.label}</Button>}
          {next && (next.key === "in_approval"
            ? <Button className="gap-1.5" onClick={() => setMove({ to: "in_approval", title: "Send for approval", label: "Send for approval", approver: true })}>
                <ChevronUp className="h-4 w-4" /> Send for approval</Button>
            : <Button className="gap-1.5" disabled={moveTask.isPending} onClick={() => moveTask.mutate({ to: next.key })}>
                <ChevronUp className="h-4 w-4" /> Promote to {next.label}</Button>)}
        </>
      )}
      {task.maturity === "in_approval" && isDecider && !isOwner && (
        <>
          <Button variant="outline" className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setMove({ to: "in_work", title: "Send back to In Work", label: "Send back", comment: true })}>
            <Undo2 className="h-4 w-4" /> Send back</Button>
          <Button className="gap-1.5 bg-green-600 hover:bg-green-700"
            onClick={() => setMove({ to: "completed", title: "Approve and complete", label: "Approve" })}>
            <Check className="h-4 w-4" /> Approve</Button>
        </>
      )}
      {task.maturity === "in_approval" && (isOwner || (canManage && !isDecider)) && (
        <Button variant="outline" className="gap-1.5" disabled={moveTask.isPending} onClick={() => moveTask.mutate({ to: "in_work" })}>
          <Undo2 className="h-4 w-4" /> Withdraw approval request</Button>
      )}
      {task.maturity === "completed" && canManage && (
        <Button variant="outline" className="gap-1.5" onClick={() => setMove({ to: "in_work", title: "Reopen task", label: "Reopen" })}>
          <RotateCcw className="h-4 w-4" /> Reopen</Button>
      )}
    </div>
  );

  return (
    <AnimatedPage>
      <Header back="/production-plan?tab=tasks" backLabel="Tasks" kind="Task" title={task.title} subtitle={projectName}
        description={task.description} chips={<MaturityChips states={TASK_STATES} current={task.maturity} />}
        owner={nameOf(task.owner_id)} modified={fmtDateTime(task.updated_at)}
        actions={canManage ? (
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive" disabled={remove.isPending}
              onClick={() => { if (window.confirm(`Delete the task "${task.title}"? This cannot be undone.`)) remove.mutate(); }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete</Button>
          </>
        ) : undefined} />

      <Tabs<typeof tab> value={tab} onChange={setTab} items={[["properties", "Properties"], ["lifecycle", "Lifecycle"], ["history", "History"]]} />

      {tab === "properties" && (
        <PropertiesTable rows={[
          ["Title", task.title],
          ["Project", <Link key="p" to={`/production-plan/project/${task.project_id}`} className="text-primary hover:underline">{projectName}</Link>],
          ["Owner", nameOf(task.owner_id)],
          ["Description", task.description || "—"],
          ["Priority", task.priority],
          ["% Complete", isOwner && !canManage && task.maturity !== "completed" ? (
            <div key="pct" className="flex items-center gap-2">
              <Input type="number" min={0} max={100} className="h-8 w-24" value={pct ?? String(task.percent_complete)} onChange={(e) => setPct(e.target.value)} />
              {pct !== null && <Button size="sm" className="h-8" disabled={savePct.isPending} onClick={() => savePct.mutate(pct)}>Save</Button>}
            </div>
          ) : <ProgressBar key="pb" value={task.percent_complete} />],
          ["Maturity", stateLabel(task.maturity)],
          ["Approver", task.approver_id ? nameOf(task.approver_id) : "—"],
          ["Creation Date", fmtDate(task.created_at)],
          ["Created by", nameOf(task.created_by)],
          ["Estimated Start", fmtDate(task.est_start)],
          ["Estimated Finish", fmtDate(task.est_finish)],
          ["Estimated Duration", task.est_duration_days != null ? `${task.est_duration_days} Days` : "—"],
          ["Actual Start", fmtDate(task.actual_start)],
          ["Actual Finish", fmtDate(task.actual_finish)],
          ["Slip Days", <span key="s" className="inline-flex items-center gap-2"><span className={cn("inline-block h-3 w-3 rounded-sm", HEALTH_CLASS[healthOf(task)])} />{slip}</span>],
          ["Deliverables", task.deliverables || "—"],
        ]} />
      )}

      {tab === "lifecycle" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-4">
            <LifecycleChain states={TASK_STATES} current={task.maturity} />
            {lifecycleActions}
            {task.maturity === "in_approval" && (
              <p className="mt-3 text-center text-xs text-ink-muted">Waiting for {nameOf(task.approver_id)} to approve.</p>
            )}
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink-primary">Approvals</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/50 text-left text-ink-secondary">
                  <tr>{["Approver", "Requested by", "Approval Status", "Requested", "Decided", "Instructions", "Comments"].map((h) =>
                    <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {approvals.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">No Objects Found</td></tr>
                  ) : approvals.map((a) => (
                    <tr key={a.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">{nameOf(a.approver_id)}</td>
                      <td className="px-3 py-2">{nameOf(a.requested_by)}</td>
                      <td className={cn("px-3 py-2 capitalize", a.status === "approved" && "text-green-700", a.status === "rejected" && "text-red-600")}>
                        {a.status === "rejected" ? "Sent back" : a.status}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(a.requested_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(a.decided_at)}</td>
                      <td className="px-3 py-2 whitespace-pre-wrap">{a.instructions ?? ""}</td>
                      <td className="px-3 py-2 whitespace-pre-wrap">{a.comment ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "history" && <HistoryTable rows={history} nameOf={nameOf} />}

      <TaskDialog open={editing} onClose={() => setEditing(false)} task={task} />
      <MoveDialog open={!!move} onClose={() => setMove(null)} title={move?.title ?? ""} confirmLabel={move?.label ?? "OK"}
        needApprover={move?.approver} needComment={move?.comment} busy={moveTask.isPending}
        onConfirm={(approver, comment) => move && moveTask.mutate({ to: move.to, approver, comment })} />
    </AnimatedPage>
  );
}

// ── Project ──────────────────────────────────────────────────────────────────
export function PlanProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { nameOf } = usePlanPeople();
  const { data: projects = [] } = usePlanProjects();
  const { data: plans = [], isLoading } = usePlans();
  const { data: tasks = [] } = usePlanTasks(id);
  const { data: history = [] } = usePlanHistory("project", id);
  const invalidate = useInvalidatePlan();
  const [tab, setTab] = useState<"properties" | "tasks" | "lifecycle" | "history">("properties");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const plan = plans.find((p) => p.project_id === id) ?? null;
  const project = projects.find((p) => p.id === id);
  const canManage = isLead(profile?.role) || (!!plan && (plan.owner_id === user?.id || plan.created_by === user?.id));

  const movePlan = useMutation({
    mutationFn: async (to: string) => {
      const { error } = await sb.rpc("pp_move_plan", { p_project_id: id, p_to: to });
      if (error) throw error;
      return to;
    },
    onSuccess: (to) => { invalidate(); toast.success(`Moved to ${stateLabel(to)}`); },
    onError: (e) => toast.error(planError(e)),
  });

  if (isLoading) return <AnimatedPage><div className="h-48 rounded-xl bg-muted animate-pulse" /></AnimatedPage>;
  if (!plan) return (
    <AnimatedPage>
      <EmptyState icon={ClipboardList} title={project ? `No plan for ${project.name} yet` : "Plan not found"}
        description={project ? "Create a plan for this project to add tasks." : "It may have been removed."} />
      <div className="mt-4 flex justify-center gap-3">
        <Link to="/production-plan" className="text-primary text-sm self-center">Back to projects</Link>
      </div>
    </AnimatedPage>
  );

  const idx = PLAN_STATES.findIndex((s) => s.key === plan.maturity);
  const prev = PLAN_STATES[idx - 1], next = PLAN_STATES[idx + 1];
  const avg = tasks.length ? tasks.reduce((s, t) => s + Number(t.percent_complete || 0), 0) / tasks.length : 0;
  const done = tasks.filter((t) => t.maturity === "completed").length;
  const late = tasks.filter((t) => t.maturity !== "completed" && slipDays(t) > 0).length;

  return (
    <AnimatedPage>
      <Header back="/production-plan" backLabel="Projects" kind="Project plan" title={project?.name ?? "—"} subtitle={plan.title ?? undefined}
        description={plan.description} chips={<MaturityChips states={PLAN_STATES} current={plan.maturity} />}
        owner={nameOf(plan.owner_id)} modified={fmtDateTime(plan.updated_at)}
        actions={canManage ? <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button> : undefined} />

      <Tabs<typeof tab> value={tab} onChange={setTab} items={[["properties", "Properties"], ["tasks", `Tasks (${tasks.length})`], ["lifecycle", "Lifecycle"], ["history", "History"]]} />

      {tab === "properties" && (
        <PropertiesTable rows={[
          ["Name", project?.name ?? "—"],
          ["Title", plan.title || "—"],
          ["Status", stateLabel(plan.maturity)],
          ["Current Phase", plan.phase || "—"],
          ["Type", plan.plan_type || "—"],
          ["Owner", nameOf(plan.owner_id)],
          ["Description", plan.description || "—"],
          ["Estimated Start", fmtDate(plan.est_start)],
          ["Estimated Finish", fmtDate(plan.est_finish)],
          ["Actual Finish", fmtDate(plan.actual_finish)],
          ["Originated", fmtDate(plan.created_at)],
          ["Created by", nameOf(plan.created_by)],
          ["Tasks", `${done} of ${tasks.length} completed${late ? ` · ${late} late` : ""}`],
          ["Progress", <ProgressBar key="p" value={avg} />],
        ]} />
      )}

      {tab === "tasks" && (
        <div className="space-y-3">
          {canManage && <div className="flex justify-end"><Button className="gap-1.5" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add task</Button></div>}
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-muted/50 text-left text-ink-secondary">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Title</th>
                  <th className="px-2 py-2.5" aria-label="Health" />
                  {["Slip Days", "Maturity", "% Complete", "Owner", "Est Start", "Est Finish"].map((h) => <th key={h} className="px-3 py-2.5 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-muted">No tasks yet{canManage ? " — click “Add task”." : ""}</td></tr>
                ) : tasks.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/production-plan/task/${t.id}`)} className="cursor-pointer border-t border-border hover:bg-muted/40">
                    <td className="px-3 py-2.5 font-medium text-primary">{t.title}</td>
                    <td className="px-2 py-2.5"><span className={cn("inline-block h-3 w-3 rounded-sm", HEALTH_CLASS[healthOf(t)])} /></td>
                    <td className={cn("px-3 py-2.5", slipDays(t) > 0 && "font-semibold text-red-600")}>{slipDays(t)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{stateLabel(t.maturity)}</td>
                    <td className="px-3 py-2.5"><ProgressBar value={t.percent_complete} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{nameOf(t.owner_id)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(t.est_start)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(t.est_finish)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "lifecycle" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <LifecycleChain states={PLAN_STATES} current={plan.maturity} />
          {canManage && (
            <div className="flex flex-wrap justify-center gap-2">
              {prev && <Button variant="outline" className="gap-1.5" disabled={movePlan.isPending} onClick={() => movePlan.mutate(prev.key)}>
                <ChevronDown className="h-4 w-4" /> Demote to {prev.label}</Button>}
              {next && <Button className="gap-1.5" disabled={movePlan.isPending} onClick={() => movePlan.mutate(next.key)}>
                <ChevronUp className="h-4 w-4" /> Promote to {next.label}</Button>}
            </div>
          )}
        </div>
      )}

      {tab === "history" && <HistoryTable rows={history} nameOf={nameOf} />}

      <PlanDialog open={editing} onClose={() => setEditing(false)} plan={plan} projectName={project?.name} />
      <TaskDialog open={adding} onClose={() => setAdding(false)} defaultProjectId={id} />
    </AnimatedPage>
  );
}
