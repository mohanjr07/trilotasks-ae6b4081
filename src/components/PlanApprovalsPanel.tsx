// Lifecycle → "Tasks/Signatures" and "Approvals" (like the 3DEXPERIENCE lifecycle page).
// Tasks/Signatures: every approval request (signature) with Show / Maturity State filters;
//                   pending ones I can sign can be approved from here (tick + green button).
// Approvals:        only the decided ones — who approved / sent back, when and why.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Check, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useInvalidatePlan } from "@/components/ProductionPlanParts";
import { TASK_STATES, stateLabel, fmtDate, fmtDateTime, isAdmin, planError, type PlanApproval, type PlanTask } from "@/lib/productionPlan";

const sb = supabase as any;
const STATUS_LABEL: Record<PlanApproval["status"], string> = {
  pending: "Awaiting approval", approved: "Approved", rejected: "Sent back", withdrawn: "Withdrawn",
};
const STATUS_CLASS: Record<PlanApproval["status"], string> = {
  pending: "text-amber-600", approved: "text-green-700", rejected: "text-red-600", withdrawn: "text-ink-muted",
};

export default function PlanApprovalsPanel({ approvals, tasks, nameOf, showRelated }: {
  approvals: PlanApproval[]; tasks: PlanTask[]; nameOf: (id?: string | null) => string; showRelated?: boolean;
}) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const invalidate = useInvalidatePlan();
  const [view, setView] = useState<"signatures" | "approvals">("signatures");
  const [show, setShow] = useState<"all" | PlanApproval["status"]>("all");
  const [stateF, setStateF] = useState("all");
  const [applied, setApplied] = useState<{ show: string; state: string }>({ show: "all", state: "all" });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const taskOf = (id: string) => tasks.find((t) => t.id === id);
  const canSign = (a: PlanApproval) => a.status === "pending" && (a.approver_id === user?.id || isAdmin(profile?.role))
    && taskOf(a.task_id)?.owner_id !== user?.id;

  const rows = useMemo(() => approvals.filter((a) => {
    if (view === "approvals" && !(a.status === "approved" || a.status === "rejected")) return false;
    if (applied.show !== "all" && a.status !== applied.show) return false;
    if (applied.state !== "all" && taskOf(a.task_id)?.maturity !== applied.state) return false;
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [approvals, tasks, view, applied]);

  const approve = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        const a = approvals.find((x) => x.id === id);
        if (!a) continue;
        const { error } = await sb.rpc("pp_move_task", { p_id: a.task_id, p_to: "completed", p_approver: null, p_comment: null });
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: (n) => { invalidate(); setPicked(new Set()); toast.success(`Approved ${n} task${n === 1 ? "" : "s"}`); },
    onError: (e) => toast.error(planError(e)),
  });

  const signable = rows.filter(canSign);
  const pickedIds = [...picked].filter((id) => signable.some((a) => a.id === id));

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex gap-1 border-b border-border px-3 pt-2">
        {([["signatures", "Tasks/Signatures"], ["approvals", "Approvals"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={cn("px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap",
              view === k ? "border-primary text-ink-primary" : "border-transparent text-ink-muted hover:text-ink-secondary")}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        {view === "signatures" && (
          <Button size="sm" className="h-8 gap-1.5 bg-green-600 hover:bg-green-700" disabled={!pickedIds.length || approve.isPending}
            title="Approve the ticked signatures" onClick={() => approve.mutate(pickedIds)}>
            <Check className="h-4 w-4" /> {pickedIds.length ? `Approve (${pickedIds.length})` : "Approve"}
          </Button>
        )}
        <label className="text-ink-muted">Show:</label>
        <select value={show} onChange={(e) => setShow(e.target.value as any)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">All Approvals</option>
          {view === "signatures" && <option value="pending">Awaiting approval</option>}
          <option value="approved">Approved</option>
          <option value="rejected">Sent back</option>
          {view === "signatures" && <option value="withdrawn">Withdrawn</option>}
        </select>
        <label className="text-ink-muted">Maturity State:</label>
        <select value={stateF} onChange={(e) => setStateF(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
          <option value="all">All</option>
          {TASK_STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setApplied({ show, state: stateF })}>
          <Filter className="h-3.5 w-3.5" /> Filter
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/50 text-left text-ink-secondary">
            <tr>
              {view === "signatures" && <th className="w-8 px-3 py-2" aria-label="Select" />}
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Approver</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Approval Status</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Approval/Due Date</th>
              <th className="px-3 py-2 font-medium">Comments/Instructions</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Related Objects</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-muted">No Objects Found</td></tr>
            ) : rows.map((a) => {
              const t = taskOf(a.task_id);
              const sign = canSign(a);
              return (
                <tr key={a.id} className="border-t border-border align-top">
                  {view === "signatures" && (
                    <td className="px-3 py-2">
                      {sign && <input type="checkbox" className="h-4 w-4 accent-primary" aria-label="Select"
                        checked={picked.has(a.id)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} />}
                    </td>
                  )}
                  <td className="px-3 py-2 whitespace-nowrap">Approve: {t?.title ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{nameOf(a.approver_id)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">In Approval → Completed</td>
                  <td className={cn("px-3 py-2 whitespace-nowrap font-medium", STATUS_CLASS[a.status])}>{STATUS_LABEL[a.status]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.decided_at ? fmtDateTime(a.decided_at) : <>Due {fmtDate(t?.est_finish)}<br /><span className="text-xs text-ink-muted">Requested {fmtDateTime(a.requested_at)}</span></>}
                  </td>
                  <td className="px-3 py-2 whitespace-pre-wrap">
                    {a.instructions && <p><span className="text-ink-muted">Instructions ({nameOf(a.requested_by)}):</span> {a.instructions}</p>}
                    {a.comment && <p><span className="text-ink-muted">Comment:</span> {a.comment}</p>}
                    {!a.instructions && !a.comment && <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {t ? (
                      <button className="text-primary hover:underline" onClick={() => navigate(`/production-plan/task/${t.id}`)}>
                        {showRelated ? t.title : "This task"}
                      </button>
                    ) : "—"}
                    {t && <span className="ml-1 text-xs text-ink-muted">({stateLabel(t.maturity)})</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
