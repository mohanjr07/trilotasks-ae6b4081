// Pieces shared by the Production Plan screens: dialogs, lifecycle chain,
// properties table, history table.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  PHASES, PLAN_TYPES, PRIORITIES, isLead, planError, usePlanPeople, usePlanProjects, usePlans, fmtDateTime,
  type Plan, type PlanTask, type PlanHistory,
} from "@/lib/productionPlan";

const sb = supabase as any;
const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="mb-1.5 block text-sm font-medium text-ink-primary">{label}</label>
      {children}
    </div>
  );
}

export function useInvalidatePlan() {
  const qc = useQueryClient();
  return () => ["pp-plans", "pp-tasks", "pp-history", "pp-approvals", "pp-projects", "pp-bom"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

// ── Plan (project) create / edit ─────────────────────────────────────────────
export function PlanDialog({ open, onClose, plan, projectName, onSaved }: {
  open: boolean; onClose: () => void; plan?: Plan | null; projectName?: string; onSaved?: (projectId: string) => void;
}) {
  const { profile, user } = useAuth();
  const lead = isLead(profile?.role);
  const { people } = usePlanPeople();
  const { data: projects = [] } = usePlanProjects();
  const { data: plans = [] } = usePlans();
  const invalidate = useInvalidatePlan();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setMode("existing"); setProjectId(""); setName("");
    setF(plan ? {
      title: plan.title ?? "", phase: plan.phase ?? "", plan_type: plan.plan_type ?? "", description: plan.description ?? "",
      est_start: plan.est_start ?? "", est_finish: plan.est_finish ?? "", actual_finish: plan.actual_finish ?? "", owner_id: plan.owner_id ?? "",
    } : { owner_id: user?.id ?? "" });
  }, [open, plan, user?.id]);

  const withoutPlan = useMemo(() => projects.filter((p) => !plans.some((pl) => pl.project_id === p.id)), [projects, plans]);

  const save = useMutation({
    mutationFn: async () => {
      const fields: Record<string, string> = { ...f };
      if (!lead) delete fields.owner_id;
      if (!plan) delete fields.actual_finish;
      if (!plan && mode === "existing" && !projectId) throw new Error("Choose a project");
      if (!plan && mode === "new" && !name.trim()) throw new Error("Enter the new project's name");
      const { data, error } = await sb.rpc("pp_save_plan", {
        p_project_id: plan ? plan.project_id : mode === "existing" ? projectId : null,
        p_name: plan || mode === "existing" ? null : name.trim(),
        p_fields: fields,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (pid) => { invalidate(); toast.success(plan ? "Plan updated" : "Plan created"); onSaved?.(pid); onClose(); },
    onError: (e) => toast.error(planError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit plan — ${projectName ?? ""}` : "New production plan"}</DialogTitle>
          <DialogDescription>{plan ? "Change the plan details." : "Pick an existing project or create a new one, then fill in the plan."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {!plan && (
            <>
              <Field label="Project *" wide>
                <div className="mb-2 flex gap-2">
                  {(["existing", "new"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setMode(m)}
                      className={cn("rounded-lg border px-3 py-1.5 text-sm", mode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-ink-secondary")}>
                      {m === "existing" ? "Existing project" : "New project"}
                    </button>
                  ))}
                </div>
                {mode === "existing" ? (
                  <select className={selectCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">Choose project…</option>
                    {withoutPlan.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : (
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coldstar_PUNE - G+2 Spiral Chute" />
                )}
              </Field>
            </>
          )}
          <Field label="Title" wide><Input value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="Short description of the work" /></Field>
          <Field label="Current phase">
            <Input list="pp-phases" value={f.phase ?? ""} onChange={(e) => set("phase", e.target.value)} placeholder="Design, Manufacturing…" />
            <datalist id="pp-phases">{PHASES.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Type">
            <Input list="pp-types" value={f.plan_type ?? ""} onChange={(e) => set("plan_type", e.target.value)} />
            <datalist id="pp-types">{PLAN_TYPES.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Owner">
            {lead ? (
              <select className={selectCls} value={f.owner_id ?? ""} onChange={(e) => set("owner_id", e.target.value)}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            ) : (
              <p className="h-10 flex items-center text-sm text-ink-secondary">{plan ? people.find((p) => p.id === plan.owner_id)?.full_name ?? "—" : "You"}</p>
            )}
          </Field>
          <div />
          <Field label="Estimated start"><Input type="date" value={f.est_start ?? ""} onChange={(e) => set("est_start", e.target.value)} /></Field>
          <Field label="Estimated finish"><Input type="date" value={f.est_finish ?? ""} onChange={(e) => set("est_finish", e.target.value)} /></Field>
          {plan && <Field label="Actual finish"><Input type="date" value={f.actual_finish ?? ""} onChange={(e) => set("actual_finish", e.target.value)} /></Field>}
          <Field label="Description" wide><Textarea rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : plan ? "Save" : "Create plan"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Task create / edit ───────────────────────────────────────────────────────
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000) + 1;

export function TaskDialog({ open, onClose, task, defaultProjectId, onSaved }: {
  open: boolean; onClose: () => void; task?: PlanTask | null; defaultProjectId?: string; onSaved?: (id: string) => void;
}) {
  const { profile, user } = useAuth();
  const lead = isLead(profile?.role);
  const { people } = usePlanPeople();
  const { data: projects = [] } = usePlanProjects();
  const { data: plans = [] } = usePlans();
  const invalidate = useInvalidatePlan();
  const [projectId, setProjectId] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((x) => {
    const n = { ...x, [k]: v };
    // fill the duration from the dates when it's empty or was worked out before
    if ((k === "est_start" || k === "est_finish") && n.est_start && n.est_finish && n.est_finish >= n.est_start
        && (!x.est_duration_days || x._auto === "1")) {
      n.est_duration_days = String(daysBetween(n.est_start, n.est_finish)); n._auto = "1";
    }
    if (k === "est_duration_days") n._auto = "";
    return n;
  });

  useEffect(() => {
    if (!open) return;
    setProjectId(task?.project_id ?? defaultProjectId ?? "");
    setF(task ? {
      title: task.title, description: task.description ?? "", priority: task.priority, owner_id: task.owner_id ?? "",
      est_start: task.est_start ?? "", est_finish: task.est_finish ?? "", est_duration_days: task.est_duration_days != null ? String(task.est_duration_days) : "",
      actual_start: task.actual_start ?? "", actual_finish: task.actual_finish ?? "", percent_complete: String(task.percent_complete ?? 0),
      deliverables: task.deliverables ?? "",
    } : { priority: "Medium", owner_id: user?.id ?? "" });
  }, [open, task, defaultProjectId, user?.id]);

  // projects this person may add tasks to
  const allowedProjects = useMemo(() => projects.filter((p) => lead ||
    plans.some((pl) => pl.project_id === p.id && pl.owner_id === user?.id)), [projects, plans, lead, user?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!task && !projectId) throw new Error("Choose a project");
      if (!(f.title ?? "").trim()) throw new Error("Enter a task title");
      const fields: Record<string, string> = { ...f };
      delete fields._auto;
      if (!task) { delete fields.actual_start; delete fields.actual_finish; delete fields.percent_complete; }
      const { data, error } = await sb.rpc("pp_save_task", { p_id: task?.id ?? null, p_project_id: task ? null : projectId, p_fields: fields });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => { invalidate(); toast.success(task ? "Task updated" : "Task added"); onSaved?.(id); onClose(); },
    onError: (e) => toast.error(planError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>{task ? "Change the task details." : "Add a task to a project and choose who owns it."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project *" wide>
            {task ? (
              <p className="text-sm text-ink-secondary">{projects.find((p) => p.id === task.project_id)?.name ?? "—"}</p>
            ) : (
              <select className={selectCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Choose project…</option>
                {allowedProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Title *" wide><Input value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Mesh Pallet with wheel" /></Field>
          <Field label="Description" wide><Textarea rows={4} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder={"1. Design\n2. 2D manufacturing drawing\n3. MBOM"} /></Field>
          <Field label="Owner">
            <select className={selectCls} value={f.owner_id ?? ""} onChange={(e) => set("owner_id", e.target.value)}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={selectCls} value={f.priority ?? "Medium"} onChange={(e) => set("priority", e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Estimated start"><Input type="date" value={f.est_start ?? ""} onChange={(e) => set("est_start", e.target.value)} /></Field>
          <Field label="Estimated finish"><Input type="date" value={f.est_finish ?? ""} onChange={(e) => set("est_finish", e.target.value)} /></Field>
          <Field label="Estimated duration (days)"><Input type="number" min={0} step="0.5" value={f.est_duration_days ?? ""} onChange={(e) => set("est_duration_days", e.target.value)} /></Field>
          {task && <Field label="% Complete"><Input type="number" min={0} max={100} value={f.percent_complete ?? "0"} onChange={(e) => set("percent_complete", e.target.value)} /></Field>}
          {task && <Field label="Actual start"><Input type="date" value={f.actual_start ?? ""} onChange={(e) => set("actual_start", e.target.value)} /></Field>}
          {task && <Field label="Actual finish"><Input type="date" value={f.actual_finish ?? ""} onChange={(e) => set("actual_finish", e.target.value)} /></Field>}
          <Field label="Deliverables" wide><Textarea rows={2} value={f.deliverables ?? ""} onChange={(e) => set("deliverables", e.target.value)} placeholder="Drawings, MBOM, cost sheet…" /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : task ? "Save" : "Add task"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Send for approval / comment ──────────────────────────────────────────────
export function MoveDialog({ open, onClose, title, needApprover, needComment, confirmLabel, onConfirm, busy }: {
  open: boolean; onClose: () => void; title: string; needApprover?: boolean; needComment?: boolean;
  confirmLabel: string; busy?: boolean; onConfirm: (approver: string | null, comment: string) => void;
}) {
  const { user } = useAuth();
  const { approvers } = usePlanPeople();
  const [approver, setApprover] = useState("");
  const [comment, setComment] = useState("");
  useEffect(() => { if (open) { setApprover(""); setComment(""); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {needApprover && (
            <Field label="Approver *">
              <select className={selectCls} value={approver} onChange={(e) => setApprover(e.target.value)}>
                <option value="">Choose…</option>
                {approvers.filter((p) => p.id !== user?.id).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
          )}
          <Field label={needComment ? "Comment *" : needApprover ? "Instructions (optional)" : "Comment (optional)"}>
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => {
            if (needApprover && !approver) { toast.error("Choose who approves this task"); return; }
            if (needComment && !comment.trim()) { toast.error("Add a comment"); return; }
            onConfirm(needApprover ? approver : null, comment.trim());
          }}>{busy ? "Saving…" : confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Lifecycle chain (Draft → To Do → …) ──────────────────────────────────────
export function LifecycleChain({ states, current }: { states: Array<{ key: string; label: string }>; current: string }) {
  const idx = states.findIndex((s) => s.key === current);
  return (
    <div className="flex flex-wrap items-center justify-center gap-y-4 py-8">
      {states.map((s, i) => (
        <Fragment key={s.key}>
          <div className={cn("rounded-[3px] px-5 sm:px-7 py-1.5 text-sm text-center whitespace-nowrap shadow-[0_1px_2px_rgba(0,0,0,0.25)]",
            i === idx ? "bg-[#3d9be0] text-white font-medium" : "bg-[#e6e6e6] text-[#333] dark:bg-muted dark:text-ink-primary")}>
            {s.label}
          </div>
          {i < states.length - 1 && (
            <div className="flex items-center shrink-0 mx-1" aria-hidden>
              <div className="h-[1.5px] w-6 sm:w-12 md:w-16 bg-ink-primary" />
              <div className="h-0 w-0 border-y-[5px] border-y-transparent border-l-[9px] border-l-ink-primary" />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** Small "prev · CURRENT · next" chips for the header. */
export function MaturityChips({ states, current }: { states: Array<{ key: string; label: string }>; current: string }) {
  const idx = states.findIndex((s) => s.key === current);
  const prev = states[idx - 1], cur = states[idx], next = states[idx + 1];
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {prev && <span className="rounded border border-border px-2 py-0.5 text-ink-muted">{prev.label}</span>}
      {cur && <span className="rounded bg-primary px-2 py-0.5 font-medium text-primary-foreground">{cur.label}</span>}
      {next && <span className="rounded border border-border px-2 py-0.5 text-ink-muted">→ {next.label}</span>}
    </div>
  );
}

// ── Properties table ─────────────────────────────────────────────────────────
export function PropertiesTable({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-border last:border-0">
              <th className="w-40 sm:w-56 bg-muted/50 px-3 py-2 text-left align-top font-medium text-ink-secondary">{label}</th>
              <td className="px-3 py-2 text-ink-primary whitespace-pre-wrap break-words">{value ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── History table ────────────────────────────────────────────────────────────
export function HistoryTable({ rows, nameOf }: { rows: PlanHistory[]; nameOf: (id?: string | null) => string }) {
  const [q, setQ] = useState("");
  // newest first
  const shown = rows.filter((r) => !q.trim() || `${r.action} ${r.description ?? ""} ${nameOf(r.user_id)}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice().sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  return (
    <div className="space-y-3">
      <div className="relative sm:w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by action, user or text" className="h-9 pl-9" />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-left text-ink-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-muted">No history yet</td></tr>
            ) : shown.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                <td className="px-3 py-2">{r.user_id ? nameOf(r.user_id) : "System"}</td>
                <td className="px-3 py-2">{r.action}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.state ?? "—"}</td>
                <td className="px-3 py-2 whitespace-pre-wrap break-words">{r.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Thin % complete bar. */
export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 sm:w-32 rounded-full border border-border bg-muted overflow-hidden">
        <div className={cn("h-full", v >= 100 ? "bg-green-600" : "bg-primary")} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs text-ink-muted tabular-nums">{Math.round(v)}%</span>
    </div>
  );
}
