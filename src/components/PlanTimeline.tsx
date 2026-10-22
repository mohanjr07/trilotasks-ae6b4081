// Production Plan → Timeline tab.
// Project: Gantt-style process timeline — every task as a bar (planned dates, % done,
//          actual dates underneath), today line, plan finish line and milestones
//          (BOM approvals, plan stage changes).
// Task:    the task's journey through Draft → To Do → In Work → In Approval → Completed,
//          with who moved it, when, and how long it stayed in each stage.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flag, CircleDot, ArrowUpCircle, ArrowDownCircle, MessageSquare, PlusCircle, Pencil, Layers, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TASK_STATES, slipDays, healthOf, stateLabel, fmtDate, fmtDateTime,
  type Plan, type PlanTask, type PlanHistory,
} from "@/lib/productionPlan";

const DAY = 86400000;
const d0 = (s: string) => { const d = new Date(s.length <= 10 ? s + "T00:00:00" : s); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const todayTs = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const ZOOM = { days: 30, weeks: 12, months: 4 } as const;
type Zoom = keyof typeof ZOOM;

function dur(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

// ── Project: Gantt ────────────────────────────────────────────────────────────
export function ProjectTimeline({ plan, tasks, history, nameOf }: {
  plan: Plan; tasks: PlanTask[]; history: PlanHistory[]; nameOf: (id?: string | null) => string;
}) {
  const navigate = useNavigate();
  const [zoom, setZoom] = useState<Zoom>("weeks");
  const ppd = ZOOM[zoom];
  const today = todayTs();

  const milestones = useMemo(() => history.filter((h) =>
    (h.action === "BOM" && /approved/i.test(h.description ?? "")) || h.action === "Promote" || h.action === "Demote" || h.action === "Create")
    .map((h) => ({
      ts: d0(h.created_at), at: h.created_at, kind: h.action === "BOM" ? "bom" : h.action === "Create" ? "start" : "stage",
      label: h.action === "BOM" ? (h.description ?? "BOM approved").replace(/ — merged.*$/, "") : h.action === "Create" ? "Plan created" : `Plan: ${h.description ?? ""}`,
      who: nameOf(h.user_id),
    })), [history, nameOf]);

  const sorted = useMemo(() => [...tasks].sort((a, b) =>
    (a.est_start ?? a.actual_start ?? a.created_at).localeCompare(b.est_start ?? b.actual_start ?? b.created_at)), [tasks]);

  const { min, max } = useMemo(() => {
    const pts: number[] = [today, d0(plan.created_at)];
    [plan.est_start, plan.est_finish, plan.actual_finish].forEach((s) => s && pts.push(d0(s)));
    tasks.forEach((t) => [t.est_start, t.est_finish, t.actual_start, t.actual_finish].forEach((s) => s && pts.push(d0(s))));
    milestones.forEach((m) => pts.push(m.ts));
    return { min: Math.min(...pts) - 3 * DAY, max: Math.max(...pts) + 7 * DAY };
  }, [plan, tasks, milestones, today]);

  const days = Math.round((max - min) / DAY) + 1;
  const width = days * ppd;
  const x = (ts: number) => Math.round(((ts - min) / DAY) * ppd);

  // header: months + ticks
  const months: Array<{ left: number; width: number; label: string }> = [];
  const ticks: Array<{ left: number; label: string; weekend?: boolean }> = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(min + i * DAY);
    if (i === 0 || dt.getDate() === 1) {
      const end = new Date(dt.getFullYear(), dt.getMonth() + 1, 1).getTime();
      months.push({ left: x(dt.getTime()), width: Math.min(x(end), width) - x(dt.getTime()), label: dt.toLocaleDateString("en-IN", { month: "short", year: "numeric" }) });
    }
    if (zoom === "days") ticks.push({ left: x(dt.getTime()), label: String(dt.getDate()), weekend: dt.getDay() === 0 });
    else if (zoom === "weeks" && dt.getDay() === 1) ticks.push({ left: x(dt.getTime()), label: String(dt.getDate()) });
  }

  const done = tasks.filter((t) => t.maturity === "completed").length;
  const late = tasks.filter((t) => t.maturity !== "completed" && slipDays(t) > 0).length;
  const LEFT = 220;
  const ROW = 44;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-border px-2.5 py-1 text-ink-secondary">{done}/{tasks.length} tasks completed</span>
          {late > 0 && <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700 dark:bg-red-900/40 dark:text-red-200">{late} late</span>}
          <span className="rounded-full border border-border px-2.5 py-1 text-ink-secondary">Plan: {fmtDate(plan.est_start)} → {fmtDate(plan.est_finish)}</span>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {(Object.keys(ZOOM) as Zoom[]).map((z) => (
            <button key={z} onClick={() => setZoom(z)}
              className={cn("rounded-md px-3 py-1 text-xs font-medium capitalize", zoom === z ? "bg-primary text-primary-foreground" : "text-ink-secondary hover:text-ink-primary")}>{z}</button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="relative" style={{ width: LEFT + width, minWidth: "100%" }}>
          {/* header */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-muted/60 text-xs text-ink-secondary">
            <div className="sticky left-0 z-30 shrink-0 border-r border-border bg-muted px-3 py-2 font-medium" style={{ width: LEFT }}>Task</div>
            <div className="relative" style={{ width, height: zoom === "months" ? 28 : 46 }}>
              {months.map((m) => <div key={m.left} className="absolute top-0 truncate border-l border-border px-1.5 py-1 font-medium" style={{ left: m.left, width: m.width }}>{m.label}</div>)}
              {ticks.map((t) => <div key={t.left} className={cn("absolute top-6 border-l border-border/60 px-0.5 text-[10px]", t.weekend && "text-red-500")} style={{ left: t.left }}>{t.label}</div>)}
            </div>
          </div>

          {/* milestones row */}
          <div className="flex border-b border-border">
            <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-card px-3 text-xs font-medium text-ink-secondary" style={{ width: LEFT, height: 34 }}>
              <Flag className="h-3.5 w-3.5" /> Milestones
            </div>
            <div className="relative" style={{ width, height: 34 }}>
              {milestones.map((m, i) => (
                <div key={i} title={`${m.label} — ${m.who}, ${fmtDateTime(m.at)}`}
                  className={cn("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border",
                    m.kind === "bom" ? "border-green-700 bg-green-500" : m.kind === "start" ? "border-slate-600 bg-slate-400" : "border-blue-700 bg-blue-500")}
                  style={{ left: x(m.ts) + ppd / 2 }} />
              ))}
            </div>
          </div>

          {/* rows */}
          {sorted.length === 0 ? (
            <div className="flex">
              <div className="sticky left-0 shrink-0 border-r border-border bg-card" style={{ width: LEFT }} />
              <p className="px-4 py-8 text-sm text-ink-muted">No tasks yet — add tasks with estimated start and finish dates to see them here.</p>
            </div>
          ) : sorted.map((t) => {
            const hasPlan = t.est_start || t.est_finish;
            const s = d0(t.est_start ?? t.est_finish!);
            const e = d0(t.est_finish ?? t.est_start!);
            const h = healthOf(t);
            const aStart = t.actual_start ? d0(t.actual_start) : null;
            const aEnd = t.actual_finish ? d0(t.actual_finish) : t.actual_start && t.maturity !== "completed" ? today : null;
            return (
              <div key={t.id} className="group flex border-b border-border last:border-0 hover:bg-muted/30">
                <button onClick={() => navigate(`/production-plan/task/${t.id}`)}
                  className="sticky left-0 z-10 shrink-0 border-r border-border bg-card px-3 py-1.5 text-left group-hover:bg-muted" style={{ width: LEFT, height: ROW }}>
                  <p className="truncate text-sm font-medium text-primary">{t.title}</p>
                  <p className="truncate text-[11px] text-ink-muted">{nameOf(t.owner_id)} · {stateLabel(t.maturity)}</p>
                </button>
                <div className="relative" style={{ width, height: ROW }}>
                  {hasPlan ? (
                    <button onClick={() => navigate(`/production-plan/task/${t.id}`)}
                      title={`${t.title}\nPlanned ${fmtDate(t.est_start)} → ${fmtDate(t.est_finish)} · ${Math.round(t.percent_complete)}% · ${stateLabel(t.maturity)}${slipDays(t) ? ` · ${slipDays(t)} days late` : ""}`}
                      className={cn("absolute top-2 h-5 overflow-hidden rounded border text-left",
                        h === "late" ? "border-red-600 bg-red-100 dark:bg-red-900/40" : h === "done" ? "border-green-700 bg-green-100 dark:bg-green-900/40"
                          : h === "soon" ? "border-amber-500 bg-amber-100 dark:bg-amber-900/40" : "border-primary/60 bg-primary/15")}
                      style={{ left: x(s), width: Math.max(ppd, x(e) - x(s) + ppd) }}>
                      <div className={cn("h-full", h === "late" ? "bg-red-500/60" : h === "done" ? "bg-green-600/60" : "bg-primary/50")} style={{ width: `${Math.min(100, Number(t.percent_complete) || 0)}%` }} />
                      <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-medium text-ink-primary whitespace-nowrap">{Math.round(t.percent_complete)}%</span>
                    </button>
                  ) : <span className="absolute left-2 top-3 text-[11px] text-ink-muted">No planned dates</span>}
                  {aStart != null && aEnd != null && (
                    <div title={`Actual ${fmtDate(t.actual_start)} → ${t.actual_finish ? fmtDate(t.actual_finish) : "in progress"}`}
                      className={cn("absolute h-1.5 rounded-full", t.maturity === "completed" ? "bg-green-700" : "bg-slate-500")}
                      style={{ left: x(aStart), width: Math.max(ppd / 2, x(aEnd) - x(aStart) + ppd), top: 32 }} />
                  )}
                </div>
              </div>
            );
          })}

          {/* today + plan finish lines */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-red-500" style={{ left: LEFT + x(today) + ppd / 2 }}>
            <span className="absolute -left-4 top-0 rounded bg-red-500 px-1 text-[9px] font-semibold text-white">Today</span>
          </div>
          {plan.est_finish && (
            <div className="pointer-events-none absolute bottom-0 top-0 z-10 border-l-2 border-dashed border-ink-primary/50" style={{ left: LEFT + x(d0(plan.est_finish)) + ppd }}>
              <span className="absolute left-1 top-0 whitespace-nowrap rounded bg-ink-primary/80 px-1 text-[9px] font-semibold text-background">Plan finish</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-5 rounded border border-primary/60 bg-primary/15" /> Planned (fill = % done)</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-5 rounded-full bg-slate-500" /> Actual</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-5 rounded border border-red-600 bg-red-100" /> Late</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rotate-45 bg-green-500" /> BOM approved</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rotate-45 bg-blue-500" /> Plan stage change</span>
      </div>
    </div>
  );
}

// ── Task: process timeline ────────────────────────────────────────────────────
const EVENT_ICON: Record<string, typeof CircleDot> = {
  Create: PlusCircle, Promote: ArrowUpCircle, Demote: ArrowDownCircle, Comment: MessageSquare, Modify: Pencil, BOM: Layers,
};

export function TaskTimeline({ task, history, nameOf, showEdits }: {
  task: PlanTask; history: PlanHistory[]; nameOf: (id?: string | null) => string; showEdits?: boolean;
}) {
  const [all, setAll] = useState(!!showEdits);
  const curIdx = TASK_STATES.findIndex((s) => s.key === task.maturity);

  // time spent in each stage (from lifecycle events)
  const moves = history.filter((h) => h.action === "Create" || h.action === "Promote" || h.action === "Demote");
  const spent = new Map<string, number>();
  const reached = new Map<string, { at: string; by: string | null }>();
  moves.forEach((m, i) => {
    const st = TASK_STATES.find((s) => s.label === m.state)?.key ?? (m.action === "Create" ? "draft" : null);
    if (!st) return;
    if (!reached.has(st) || m.action !== "Demote") reached.set(st, { at: m.created_at, by: m.user_id });
    const end = moves[i + 1] ? new Date(moves[i + 1].created_at).getTime() : Date.now();
    spent.set(st, (spent.get(st) ?? 0) + (end - new Date(m.created_at).getTime()));
  });

  const events = history.filter((h) => all || h.action !== "Modify" || /Approver|Owner|Actual/i.test(h.description ?? ""));
  const slip = slipDays(task);

  return (
    <div className="space-y-5">
      {/* stage strip */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid gap-2 sm:grid-cols-5">
          {TASK_STATES.map((s, i) => {
            const r = reached.get(s.key);
            const isCur = i === curIdx;
            const isDone = i < curIdx || (task.maturity === "completed" && s.key === "completed");
            return (
              <div key={s.key} className={cn("relative rounded-lg border p-3",
                isCur ? "border-primary bg-primary/10" : isDone ? "border-green-600/40 bg-green-50 dark:bg-green-900/20" : "border-border bg-muted/30")}>
                <div className="flex items-center gap-1.5">
                  {isDone && !isCur ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <CircleDot className={cn("h-4 w-4", isCur ? "text-primary" : "text-ink-muted")} />}
                  <span className={cn("text-sm font-medium", isCur ? "text-primary" : "text-ink-primary")}>{s.label}</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-muted">{r ? `${fmtDateTime(r.at)}` : "—"}</p>
                {r && <p className="text-[11px] text-ink-muted truncate">by {r.by ? nameOf(r.by) : "System"}</p>}
                {spent.get(s.key) != null && s.key !== "completed" && (
                  <p className="mt-1 text-[11px] font-medium text-ink-secondary">{isCur ? "for " : "took "}{dur(spent.get(s.key)!)}</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          <p><span className="text-ink-muted">Planned:</span> {fmtDate(task.est_start)} → {fmtDate(task.est_finish)}</p>
          <p><span className="text-ink-muted">Actual:</span> {fmtDate(task.actual_start)} → {task.actual_finish ? fmtDate(task.actual_finish) : task.actual_start ? "in progress" : "—"}</p>
          <p><span className="text-ink-muted">Duration (est.):</span> {task.est_duration_days != null ? `${task.est_duration_days} days` : "—"}</p>
          <p className={cn(slip > 0 && "font-semibold text-red-600")}><span className="font-normal text-ink-muted">Slip:</span> {slip} day{slip === 1 ? "" : "s"}</p>
        </div>
      </div>

      {/* event list */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-primary">Process timeline</h3>
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every edit
          </label>
        </div>
        {events.length === 0 ? <p className="text-sm text-ink-muted">Nothing yet.</p> : (
          <ol className="relative ml-3 border-l border-border">
            {events.map((h, i) => {
              const Icon = EVENT_ICON[h.action] ?? CircleDot;
              const prev = events[i - 1];
              const gap = prev ? new Date(h.created_at).getTime() - new Date(prev.created_at).getTime() : 0;
              return (
                <li key={h.id} className="mb-4 ml-5 last:mb-0">
                  <span className={cn("absolute -left-[11px] flex h-[22px] w-[22px] items-center justify-center rounded-full border bg-card",
                    h.action === "Promote" ? "border-primary text-primary" : h.action === "Demote" ? "border-red-500 text-red-600"
                      : h.action === "Create" ? "border-green-600 text-green-700" : "border-border text-ink-muted")}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  {prev && gap > 60000 && <p className="-mt-1 mb-1 text-[10px] text-ink-muted">+ {dur(gap)}</p>}
                  <p className="text-sm text-ink-primary">
                    <span className="font-medium">{h.action === "Promote" || h.action === "Demote" ? `${h.action}d` : h.action}</span>
                    {h.description ? ` — ${h.description}` : ""}
                  </p>
                  <p className="text-[11px] text-ink-muted">{fmtDateTime(h.created_at)} · {h.user_id ? nameOf(h.user_id) : "System"}{h.state ? ` · ${h.state}` : ""}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Project process timeline as a list (milestones + plan events), shown under the Gantt. */
export function ProjectEvents({ history, nameOf }: { history: PlanHistory[]; nameOf: (id?: string | null) => string }) {
  const key = history.filter((h) => h.action !== "Modify");
  if (!key.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink-primary">Key events</h3>
      <ol className="relative ml-3 border-l border-border">
        {key.slice().reverse().slice(0, 40).map((h) => {
          const Icon = EVENT_ICON[h.action] ?? CircleDot;
          return (
            <li key={h.id} className="mb-3 ml-5 last:mb-0">
              <span className="absolute -left-[11px] flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-card text-ink-muted"><Icon className="h-3.5 w-3.5" /></span>
              <p className="text-sm text-ink-primary"><span className="font-medium">{h.action}</span>{h.description ? ` — ${h.description}` : ""}</p>
              <p className="text-[11px] text-ink-muted">{fmtDateTime(h.created_at)} · {h.user_id ? nameOf(h.user_id) : "System"}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
