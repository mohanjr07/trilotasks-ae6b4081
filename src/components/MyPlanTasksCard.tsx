// Dashboard card: my open Production Plan tasks and the ones waiting for my approval.
// Shows nothing when I'm not part of any plan.
import { useNavigate } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { usePlanTasks, usePlanProjects, slipDays, healthOf, HEALTH_CLASS, stateLabel, fmtDate } from "@/lib/productionPlan";

export default function MyPlanTasksCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: tasks = [], error } = usePlanTasks();
  const { data: projects = [] } = usePlanProjects();
  if (error || !user) return null;

  const mine = tasks.filter((t) =>
    (t.owner_id === user.id && t.maturity !== "completed") || (t.approver_id === user.id && t.maturity === "in_approval"));
  if (!mine.length) return null;
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";

  return (
    <div className="mt-6 rounded-card bg-card p-4 sm:p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-primary"><CalendarRange className="h-4 w-4 text-primary" /> Production Plan</h3>
        <button className="text-xs text-primary hover:underline" onClick={() => navigate("/production-plan?tab=tasks")}>Open</button>
      </div>
      <div className="space-y-1">
        {mine.slice(0, 8).map((t) => {
          const slip = slipDays(t);
          const waiting = t.approver_id === user.id && t.maturity === "in_approval";
          return (
            <button key={t.id} onClick={() => navigate(`/production-plan/task/${t.id}`)}
              className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left hover:bg-muted transition-colors">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", HEALTH_CLASS[healthOf(t)])} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-primary">{t.title}</p>
                <p className="truncate text-xs text-ink-muted">{projectName(t.project_id)}{t.est_finish ? ` · due ${fmtDate(t.est_finish)}` : ""}</p>
              </div>
              {waiting
                ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Approve</span>
                : <span className="text-xs text-ink-secondary whitespace-nowrap">{stateLabel(t.maturity)}</span>}
              {slip > 0 && <span className="text-xs font-semibold text-red-600 whitespace-nowrap">{slip}d late</span>}
            </button>
          );
        })}
      </div>
      {mine.length > 8 && <p className="mt-2 text-xs text-ink-muted">+{mine.length - 8} more</p>}
    </div>
  );
}
