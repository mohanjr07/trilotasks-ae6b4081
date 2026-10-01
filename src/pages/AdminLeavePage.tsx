import { useState, useEffect } from "react";
import MobileSegments from "@/components/MobileSegments";
import { motion, AnimatePresence } from "framer-motion";
import { Search, CheckCircle2, XCircle, Clock, Calendar as CalendarIcon, X, Plus, RotateCcw, FileSpreadsheet, Trash2, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { exportLeavesToExcel } from "@/lib/leaveExcelExport";
import LeaveBalanceTable from "@/components/LeaveBalanceTable";
import { PERSON_MERGE } from "@/lib/personMerge";

export default function AdminLeavePage() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const isStrictAdmin = profile?.role === "admin";
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [reviewReq, setReviewReq] = useState<any>(null);
  const [showAssignLeave, setShowAssignLeave] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [deleteReq, setDeleteReq] = useState<any>(null);
  const [selectedLeave, setSelectedLeave] = useState<any>(null);

  const clearRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leave_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-leave"] });
      toast.success("Request cleared");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leave_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-leave"] });
      queryClient.invalidateQueries({ queryKey: ["my-leave"] });
      toast.success("Leave deleted permanently");
      setDeleteReq(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Revert an already-approved leave so it no longer counts as leave.
  // Primary strategy: set reverted_at + reverted_by and drop status back to "pending"
  //   (this way the quota calculator will skip the row because reverted_at is set).
  // Fallback (if the columns don't exist yet): set status to "rejected" with a note
  //   so the day no longer counts.
  const revertRequest = useMutation({
    mutationFn: async (req: any) => {
      // Try primary: reverted_at columns
      const primary = await supabase
        .from("leave_requests")
        .update({
          status: "pending",
          reverted_at: new Date().toISOString(),
          reverted_by: user!.id,
          admin_note: "Leave reverted by admin — does not count as leave.",
        })
        .eq("id", req.id);
      if (primary.error) {
        const msg = primary.error.message ?? "";
        const missingCol =
          msg.includes("reverted_at") ||
          msg.includes("reverted_by") ||
          msg.includes("schema cache") ||
          primary.error.code === "42703";
        if (missingCol) {
          // Fallback: mark rejected so the day no longer counts
          const fallback = await supabase
            .from("leave_requests")
            .update({
              status: "rejected",
              admin_note: "Reverted by admin (rollback). Does not count as leave.",
              reviewed_by: user!.id,
              reviewed_at: new Date().toISOString(),
            })
            .eq("id", req.id);
          if (fallback.error) throw fallback.error;
          return { usedFallback: true };
        }
        throw primary.error;
      }
      return { usedFallback: false };
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["admin-leave"] });
      queryClient.invalidateQueries({ queryKey: ["casual-leave-usage"] });
      queryClient.invalidateQueries({ queryKey: ["my-leave"] });
      // Invalidate People page caches so attendance % reflects the revert immediately
      queryClient.invalidateQueries({ queryKey: ["people-month-leaves"] });
      queryClient.invalidateQueries({ queryKey: ["people-leaves"] });
      if (result?.usedFallback) {
        toast.message("Reverted (as rejected). Run fix_half_day_and_revert.sql to enable a dedicated Reverted status.");
      } else {
        toast.success("Leave reverted — no longer counted as leave");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: requests = [] } = useQuery({
    queryKey: ["admin-leave"],
    queryFn: async () => {
      const { data } = await supabase.from("leave_requests")
        .select("*, employee:profiles!leave_requests_employee_id_fkey(full_name, avatar_url, department), reviewer:profiles!leave_requests_reviewed_by_fkey(full_name, avatar_url)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const filtered = requests.filter((r: any) => {
    const isReverted = !!r.reverted_at;
    if (tab === "reverted") {
      if (!isReverted) return false;
    } else if (tab !== "all") {
      if (isReverted) return false;           // hide reverted from pending/approved/rejected
      if (r.status !== tab) return false;
    }
    if (search && !r.employee?.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const pending = requests.filter((r: any) => r.status === "pending" && !r.reverted_at).length;
  const approved = requests.filter((r: any) => r.status === "approved" && !r.reverted_at).length;
  const rejected = requests.filter((r: any) => r.status === "rejected" && !r.reverted_at).length;
  const reverted = requests.filter((r: any) => !!r.reverted_at).length;

  const tabs = [
    { key: "all", label: "All" },
    { key: "pending", label: `Pending (${pending})` },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "reverted", label: `Reverted${reverted ? ` (${reverted})` : ""}` },
    // Paid-leave balance — admins only
    ...(isStrictAdmin ? [{ key: "balance", label: "Leave Balance" }] : []),
  ];

  return (
    <AnimatedPage>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="font-heading text-2xl sm:text-[28px] font-bold text-ink-primary flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Leave & Permissions</span> {pending > 0 && <span className="text-xs sm:text-sm font-body font-medium bg-warning-light text-warning px-2 py-0.5 rounded-pill whitespace-nowrap">{pending} pending</span>}
        </h1>
        {isStrictAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowExport(true)} size="sm" variant="outline">
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export to Excel
            </Button>
            <Button onClick={() => setShowAssignLeave(true)} size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Assign Leave
            </Button>
          </div>
        )}
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <StatCard title="Total" value={requests.length} icon={CalendarIcon} />
        <StatCard title="Approved" value={approved} icon={CheckCircle2} iconBg="bg-success-light" iconColor="text-success" />
        <StatCard title="Rejected" value={rejected} icon={XCircle} iconBg="bg-destructive-light" iconColor="text-destructive" />
        <StatCard title="Pending" value={pending} icon={Clock} iconBg="bg-warning-light" iconColor="text-warning" />
      </motion.div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <MobileSegments
          className="w-full"
          items={tabs.map((t) => ({ key: t.key, label: t.label.replace(/\s*\(\d+\)/, ""), count: t.key === "pending" ? pending : t.key === "reverted" ? reverted : undefined }))}
          value={tab as any}
          onChange={(k) => setTab(k as any)}
        />
        <div className="hidden md:flex gap-1 border-b border-border flex-1 min-w-0">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? "text-primary" : "text-ink-muted hover:text-ink-secondary"}`}>
              {t.label}
              {tab === t.key && <motion.div layoutId="admin-leave-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee..." className="pl-9 h-9" />
        </div>
      </div>

      {tab === "balance" && isStrictAdmin ? (
        <LeaveBalanceTable requests={requests} search={search} />
      ) : (
      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
        {filtered.map((req: any) => {
          const isReverted = !!req.reverted_at;
          const displayStatus = isReverted ? "reverted" : (req.status ?? "pending");
          return (
          <motion.div key={req.id} variants={staggerItem}
            className={`flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 sm:gap-4 rounded-card bg-card p-3 sm:p-4 shadow-card hover:shadow-card-hover transition-shadow cursor-pointer ${isReverted ? "opacity-70" : ""}`}
            onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; setSelectedLeave(req); }}>
            <UserAvatar name={req.employee?.full_name ?? "?"} avatarUrl={req.employee?.avatar_url} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-primary">
                {req.employee?.full_name}
                {req.is_half_day && (
                  <span className="ml-2 text-[10px] font-semibold bg-purple-light text-purple px-1.5 py-0.5 rounded-pill align-middle">
                    Half Day{req.half_day_period ? ` · ${req.half_day_period}` : ""}
                  </span>
                )}
              </p>
              <p className="text-xs text-ink-muted">
                {req.leave_category === "casual_leave" ? "Casual Leave" : req.leave_category === "on_duty" ? "On Duty" : req.leave_category === "work_from_home" ? "Work From Home" : req.leave_category === "unauthorised_leave" ? "Unauthorised Leave" : req.leave_category === "late" ? "Late" : req.leave_category === "permission" || req.type === "permission" ? "Permission" : req.leave_category ?? req.type}
                {" · "}
                {req.start_date && format(new Date(req.start_date), "MMM d")}
                {req.end_date && req.end_date !== req.start_date && `–${format(new Date(req.end_date), "MMM d")}`}
                {req.start_time && ` · ${String(req.start_time).slice(0, 5)}–${String(req.end_time).slice(0, 5)}`}
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto pl-[52px] sm:pl-0">
            <StatusBadge status={displayStatus} />
            {isStrictAdmin && req.status === "pending" && !isReverted && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-success border-success/30 hover:bg-success-light"
                  onClick={() => setReviewReq({ ...req, action: "approved" })}>✓</Button>
                <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive-light"
                  onClick={() => setReviewReq({ ...req, action: "rejected" })}>✗</Button>
              </div>
            )}
            {isStrictAdmin && req.status === "approved" && !isReverted && (
              <Button
                size="sm"
                variant="outline"
                className="text-ink-muted border-border hover:bg-muted gap-1.5"
                onClick={() => {
                  if (window.confirm(`Revert approved leave for ${req.employee?.full_name}? It will no longer count as leave.`)) {
                    revertRequest.mutate(req);
                  }
                }}
                disabled={revertRequest.isPending}
                title="Revert this approved leave"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Revert
              </Button>
            )}
            {isStrictAdmin && (req.status === "rejected" || isReverted) && (
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 text-destructive border-destructive/30 hover:bg-destructive-light"
                onClick={(e) => { e.stopPropagation(); setDeleteReq(req); }}
                title={isReverted ? "Delete this reverted leave permanently" : "Delete this rejected leave permanently"}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            </div>
          </motion.div>
          );
        })}
        {filtered.length === 0 && <div className="py-16 text-center text-sm text-ink-muted">No requests found</div>}
      </motion.div>
      )}

      <ReviewModal request={reviewReq} onClose={() => setReviewReq(null)} />
      <LeaveDetailModal request={selectedLeave} onClose={() => setSelectedLeave(null)} />
      <DeleteLeaveModal
        request={deleteReq}
        onClose={() => setDeleteReq(null)}
        onConfirm={() => deleteReq && deleteRequest.mutate(deleteReq.id)}
        isPending={deleteRequest.isPending}
      />
      {isStrictAdmin && <AssignLeaveModal open={showAssignLeave} onClose={() => setShowAssignLeave(false)} />}
      {isStrictAdmin && <ExportLeaveModal open={showExport} onClose={() => setShowExport(false)} />}
    </AnimatedPage>
  );
}

function LeaveDetailModal({ request, onClose }: { request: any; onClose: () => void }) {
  if (!request) return null;
  const isReverted = !!request.reverted_at;
  const displayStatus = isReverted ? "reverted" : (request.status ?? "pending");

  const leaveTypeLabel =
    request.leave_category === "casual_leave" ? "Casual Leave"
    : request.leave_category === "on_duty" ? "On Duty"
    : request.leave_category === "work_from_home" ? "Work From Home"
    : request.leave_category === "unauthorised_leave" ? "Unauthorised Leave"
    : request.leave_category === "late" ? "Late"
    : request.leave_category === "permission" || request.type === "permission" ? "Permission"
    : request.leave_category ?? request.type ?? "—";

  return (
    <AnimatePresence>
      {request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/30"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-[480px] rounded-modal bg-card p-5 sm:p-6 shadow-modal mx-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <UserAvatar name={request.employee?.full_name ?? "?"} avatarUrl={request.employee?.avatar_url} size="md" />
                <div>
                  <h2 className="font-heading text-lg font-bold text-ink-primary leading-tight">
                    {request.employee?.full_name}
                  </h2>
                  {request.employee?.department && (
                    <p className="text-xs text-ink-muted">{request.employee.department}</p>
                  )}
                </div>
              </div>
              <button onClick={onClose} className="text-ink-muted hover:text-ink-primary">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-2 mb-5">
              <StatusBadge status={displayStatus} />
              {request.is_half_day && (
                <span className="text-[10px] font-semibold bg-purple-light text-purple px-1.5 py-0.5 rounded-pill">
                  Half Day{request.half_day_period ? ` · ${request.half_day_period}` : ""}
                </span>
              )}
            </div>

            {/* Details grid */}
            <div className="rounded-lg bg-muted/40 divide-y divide-border text-sm mb-5">
              <div className="flex justify-between px-4 py-3">
                <span className="text-ink-muted">Leave Type</span>
                <span className="text-ink-primary font-medium">{leaveTypeLabel}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-ink-muted">Period</span>
                <span className="text-ink-primary font-medium">
                  {request.start_date && format(new Date(request.start_date), "MMM d, yyyy")}
                  {request.end_date && request.end_date !== request.start_date
                    ? ` – ${format(new Date(request.end_date), "MMM d, yyyy")}`
                    : ""}
                  {request.start_time && ` · ${String(request.start_time).slice(0, 5)} – ${String(request.end_time).slice(0, 5)}`}
                </span>
              </div>
              {request.reason && (
                <div className="px-4 py-3">
                  <span className="text-ink-muted block mb-1">Reason</span>
                  <span className="text-ink-primary">{request.reason}</span>
                </div>
              )}
              {request.admin_note && (
                <div className="px-4 py-3">
                  <span className="text-ink-muted block mb-1">Admin Note</span>
                  <span className="text-ink-primary">{request.admin_note}</span>
                </div>
              )}
              {request.created_at && (
                <div className="flex justify-between px-4 py-3">
                  <span className="text-ink-muted">Applied On</span>
                  <span className="text-ink-primary">{format(new Date(request.created_at), "MMM d, yyyy · h:mm a")}</span>
                </div>
              )}
              {request.reviewed_at && request.reviewer?.full_name && (
                <div className="flex justify-between px-4 py-3">
                  <span className="text-ink-muted">
                    {request.status === "approved" ? "Approved By" : request.status === "rejected" ? "Rejected By" : "Reviewed By"}
                  </span>
                  <span className="flex items-center gap-2 text-ink-primary font-medium">
                    <UserAvatar name={request.reviewer.full_name} avatarUrl={request.reviewer.avatar_url} size="sm" />
                    {request.reviewer.full_name}
                  </span>
                </div>
              )}
              {request.reviewed_at && (
                <div className="flex justify-between px-4 py-3">
                  <span className="text-ink-muted">Reviewed On</span>
                  <span className="text-ink-primary">{format(new Date(request.reviewed_at), "MMM d, yyyy · h:mm a")}</span>
                </div>
              )}
              {isReverted && request.reverted_at && (
                <div className="flex justify-between px-4 py-3">
                  <span className="text-ink-muted">Reverted On</span>
                  <span className="text-ink-primary">{format(new Date(request.reverted_at), "MMM d, yyyy · h:mm a")}</span>
                </div>
              )}
            </div>

            <Button variant="outline" onClick={onClose} className="w-full">Close</Button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function ReviewModal({ request, onClose }: { request: any; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const review = useMutation({
    mutationFn: async () => {
      await supabase.from("leave_requests").update({
        status: request.action,
        reviewed_by: user!.id,
        reviewed_at: new Date().toISOString(),
        admin_note: note || null,
      }).eq("id", request.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-leave"] });
      toast.success(`Request ${request.action}`);
      onClose();
    },
  });

  if (!request) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-[460px] rounded-modal bg-card p-5 sm:p-6 shadow-modal mx-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-lg font-bold text-ink-primary">
              {request.action === "approved" ? "Approve" : "Reject"} Request
            </h2>
            <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
          </div>

          <div className="space-y-3 mb-4 text-sm">
            <div className="flex justify-between"><span className="text-ink-muted">Employee</span><span className="text-ink-primary font-medium">{request.employee?.full_name}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Type</span><span className="text-ink-primary capitalize">{request.type}{request.leave_category ? ` (${request.leave_category})` : ""}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Period</span>
              <span className="text-ink-primary">
                {format(new Date(request.start_date), "MMM d")}
                {request.end_date && request.end_date !== request.start_date && `–${format(new Date(request.end_date), "MMM d")}`}
              </span>
            </div>
            <div><span className="text-ink-muted">Reason</span><p className="mt-1 text-ink-primary">{request.reason}</p></div>
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Admin Note (optional)</label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note..." />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={() => review.mutate()} disabled={review.isPending}
              className={`flex-1 ${request.action === "approved" ? "bg-success hover:bg-success/90" : "bg-destructive hover:bg-destructive/90"}`}>
              {review.isPending ? "Processing..." : request.action === "approved" ? "Approve" : "Reject"}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function AssignLeaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [leaveCategory, setLeaveCategory] = useState("casual_leave");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  // Half-day toggle — available for every category except Permission
  // (which uses an explicit time range instead).
  // For "Late" the default is half-day to match the previous behaviour;
  // for every other category the default is full-day.
  const [duration, setDuration] = useState<"full" | "half">("full");
  const [halfDayPeriod, setHalfDayPeriod] = useState<"AM" | "PM">("AM");
  // "Permission" time range — only used when leaveCategory === "permission"
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const isPermission = leaveCategory === "permission";
  // Half-day is allowed for everything that isn't a Permission (which is
  // already a partial-day construct of its own).
  const supportsHalfDay = !isPermission;
  const isHalfDay = supportsHalfDay && duration === "half";

  const resetForm = () => {
    setEmployeeId("");
    setLeaveCategory("casual_leave");
    setStartDate("");
    setEndDate("");
    setReason("");
    setDuration("full");
    setHalfDayPeriod("AM");
    setStartTime("");
    setEndTime("");
  };

  // When the user switches to "Late", auto-default to half-day (its old behaviour).
  // Switching away from Late doesn't auto-reset — the admin's explicit choice wins.
  useEffect(() => {
    if (leaveCategory === "late") setDuration("half");
  }, [leaveCategory]);

  const { data: employees = [] } = useQuery({
    queryKey: ["all-employees"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name");
      return data ?? [];
    },
    enabled: open,
  });

  const assign = useMutation({
    mutationFn: async () => {
      if (!employeeId || !startDate || !reason.trim()) {
        toast.error("Employee, start date, and reason are required");
        return;
      }
      if (isPermission) {
        if (!startTime || !endTime) {
          toast.error("Start time and end time are required for Permission");
          return;
        }
        if (startTime >= endTime) {
          toast.error("End time must be after start time");
          return;
        }
      }
      const payload: Record<string, unknown> = {
        employee_id: employeeId,
        type: isPermission
          ? "permission"
          : leaveCategory === "on_duty"
          ? "on_duty"
          : "leave",
        leave_category: leaveCategory,
        start_date: startDate,
        // Half-day and Permission both collapse to a single date
        end_date: isHalfDay || isPermission ? startDate : endDate || startDate,
        reason: reason.trim(),
        status: "approved",
        reviewed_by: user!.id,
        reviewed_at: new Date().toISOString(),
      };
      if (isHalfDay) {
        payload.is_half_day = true;
        payload.half_day_period = halfDayPeriod; // AM = First Half, PM = Second Half
      }
      if (isPermission) {
        payload.start_time = startTime;
        payload.end_time = endTime;
      }
      const { error } = await supabase.from("leave_requests").insert([payload as any]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-leave"] });
      queryClient.invalidateQueries({ queryKey: ["casual-leave-usage"] });
      queryClient.invalidateQueries({ queryKey: ["my-leave"] });
      toast.success("Leave assigned on behalf of employee");
      resetForm();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-[460px] rounded-modal bg-card p-5 sm:p-6 shadow-modal mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-bold text-ink-primary">
                {isPermission ? "Assign Permission on Behalf" : "Assign Leave on Behalf"}
              </h2>
              <button onClick={onClose} className="text-ink-muted hover:text-ink-primary"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Employee *</label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e: any) => (
                      <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Leave Category *</label>
                <Select value={leaveCategory} onValueChange={setLeaveCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="casual_leave">Casual Leave</SelectItem>
                    <SelectItem value="on_duty">On Duty</SelectItem>
                    <SelectItem value="work_from_home">Work From Home</SelectItem>
                    <SelectItem value="unauthorised_leave">Unauthorised Leave</SelectItem>
                    <SelectItem value="late">Late</SelectItem>
                    <SelectItem value="permission">Permission</SelectItem>
                  </SelectContent>
                </Select>
                {isPermission && (
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Short time-off during work hours — pick date, start time, and end time.
                  </p>
                )}
              </div>

              {supportsHalfDay && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ink-secondary">Duration *</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDuration("full")}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                          duration === "full"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-ink-secondary hover:bg-muted"
                        }`}
                      >
                        Full Day
                      </button>
                      <button
                        type="button"
                        onClick={() => setDuration("half")}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                          duration === "half"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-ink-secondary hover:bg-muted"
                        }`}
                      >
                        Half Day
                      </button>
                    </div>
                  </div>

                  {isHalfDay && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-secondary">Half Day Period *</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setHalfDayPeriod("AM")}
                          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            halfDayPeriod === "AM"
                              ? "border-primary bg-accent-light text-primary"
                              : "border-border bg-card text-ink-secondary hover:bg-muted"
                          }`}
                        >
                          First Half
                        </button>
                        <button
                          type="button"
                          onClick={() => setHalfDayPeriod("PM")}
                          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            halfDayPeriod === "PM"
                              ? "border-primary bg-accent-light text-primary"
                              : "border-border bg-card text-ink-secondary hover:bg-muted"
                          }`}
                        >
                          Second Half
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11px] text-ink-muted">
                        Employee will be marked as half-day for the {halfDayPeriod === "AM" ? "first" : "second"} half of the day.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {isPermission ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-primary">Date *</label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-ink-primary">Start Time *</label>
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-ink-primary">End Time *</label>
                      <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-primary">
                      {isHalfDay ? "Date *" : "Start Date *"}
                    </label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-primary">End Date</label>
                    <Input
                      type="date"
                      value={isHalfDay ? "" : endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      disabled={isHalfDay}
                      placeholder={isHalfDay ? "Not used for half-day" : undefined}
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Reason *</label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for leave..." />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
                <Button onClick={() => assign.mutate()} disabled={assign.isPending} className="flex-1">
                  {assign.isPending ? "Assigning..." : isPermission ? "Assign Permission" : "Assign Leave"}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ─── Export Leave Modal (admin only) ─────────────────────────────────────────
//   Asks the admin to pick a month + year, fetches every active employee and
//   every leave_request that overlaps the chosen month, then hands the data
//   to leaveExcelExport.ts which renders the attendance grid spreadsheet.
function ExportLeaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [exporting, setExporting] = useState(false);

  const monthOptions = [
    { v: 1, l: "January" }, { v: 2, l: "February" }, { v: 3, l: "March" },
    { v: 4, l: "April" }, { v: 5, l: "May" }, { v: 6, l: "June" },
    { v: 7, l: "July" }, { v: 8, l: "August" }, { v: 9, l: "September" },
    { v: 10, l: "October" }, { v: 11, l: "November" }, { v: 12, l: "December" },
  ];
  const yearOptions: number[] = [];
  for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++) yearOptions.push(y);

  const handleExport = async () => {
    setExporting(true);
    try {
      // 1) Leave requests touching the chosen month.
      // Local YYYY-MM-DD (toISOString() shifts India midnight to the previous day,
      // which dropped every leave starting on the last day of the month).
      const pad = (n: number) => String(n).padStart(2, "0");
      const monthStart = `${year}-${pad(month)}-01`;
      const monthEnd = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
      // Touches the month if start_date <= monthEnd AND (end_date >= monthStart OR end_date is null).
      const overlapFilter = `end_date.gte.${monthStart},end_date.is.null`;
      let leaveRequests: any[] = [];
      const reqRes = await supabase
        .from("leave_requests")
        .select("employee_id, start_date, end_date, reverted_at, status, type, leave_category, is_half_day, half_day_period")
        .lte("start_date", monthEnd)
        .or(overlapFilter);
      if (reqRes.error) {
        // Fallback if reverted_at column doesn't exist yet — re-query without it
        if (reqRes.error.code === "42703" || (reqRes.error.message ?? "").includes("reverted_at")) {
          const fallback = await supabase
            .from("leave_requests")
            .select("employee_id, start_date, end_date, status, type, leave_category, is_half_day, half_day_period")
            .lte("start_date", monthEnd)
            .or(overlapFilter);
          if (fallback.error) throw fallback.error;
          leaveRequests = fallback.data ?? [];
        } else {
          throw reqRes.error;
        }
      } else {
        leaveRequests = reqRes.data ?? [];
      }

      // People with an approved (not reverted) leave this month must ALWAYS appear,
      // even if they are an admin or have since been deactivated.
      const withLeave = new Set(
        leaveRequests
          .filter((r: any) => (!r.status || r.status === "approved") && !r.reverted_at)
          .map((r: any) => r.employee_id as string),
      );

      // 2) Rows: active non-admin employees + anyone who has a leave this month.
      const empRes = await supabase
        .from("profiles")
        .select("id, full_name, role, is_active")
        .order("full_name");
      if (empRes.error) throw empRes.error;
      const adminRoles = new Set(["admin", "super_admin"]);
      const allEmployees = (empRes.data ?? [])
        .filter((e: any) =>
          withLeave.has(e.id) || (e.is_active !== false && !adminRoles.has(e.role)),
        )
        .map(({ id, full_name }: any) => ({ id, full_name: full_name || "(no name)" })) as Array<{ id: string; full_name: string }>;

      // Same person with two accounts → ONE row on the sheet (Excel only; the
      // accounts stay separate in the app). Key = lower-case name, value = row name.
      const EXCEL_MERGE = PERSON_MERGE;
      {
        const canonicalId: Record<string, string> = {}; // row name → id that keeps the row
        const remap: Record<string, string> = {};        // other account id → kept id
        const merged: Array<{ id: string; full_name: string }> = [];
        for (const e of allEmployees) {
          const target = EXCEL_MERGE[(e.full_name ?? "").trim().toLowerCase()];
          if (!target) { merged.push(e); continue; }
          if (!canonicalId[target]) {
            canonicalId[target] = e.id;
            merged.push({ id: e.id, full_name: target });
          } else {
            remap[e.id] = canonicalId[target];
          }
        }
        // Profiles not in the row list (e.g. admin duplicate without leave) still merge
        for (const p of empRes.data ?? []) {
          const target = EXCEL_MERGE[((p as any).full_name ?? "").trim().toLowerCase()];
          if (target && canonicalId[target] && (p as any).id !== canonicalId[target]) remap[(p as any).id] = canonicalId[target];
        }
        leaveRequests = leaveRequests.map((r: any) =>
          remap[r.employee_id] ? { ...r, employee_id: remap[r.employee_id] } : r,
        );
        allEmployees.splice(0, allEmployees.length, ...merged);
      }

      // Employees that belong to the separate MAPL table (case-insensitive name match)
      const MAPL_NAMES = new Set(["lingesh", "surya barani", "jagadesh"]);
      const employees = allEmployees.filter(
        (e) => !MAPL_NAMES.has((e.full_name ?? "").trim().toLowerCase()),
      );
      const maplEmployees = allEmployees.filter(
        (e) => MAPL_NAMES.has((e.full_name ?? "").trim().toLowerCase()),
      );
      const additionalGroups = maplEmployees.length
        ? [{ title: "MAPL", employees: maplEmployees }]
        : [];

      await exportLeavesToExcel({ year, month, employees, leaveRequests, additionalGroups });
      toast.success("Excel file ready — check your downloads");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to export");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-[420px] rounded-modal bg-card p-5 sm:p-6 shadow-modal mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-bold text-ink-primary">Export Leave Records</h2>
              <button onClick={onClose} className="text-ink-muted hover:text-ink-primary"><X className="h-5 w-5" /></button>
            </div>

            <p className="text-sm text-ink-muted mb-4">
              Generates the monthly attendance sheet — present rows stay blank, leaves are marked
              <span className="font-semibold text-ink-primary"> L</span>, half-days mark only F or A,
              and Sundays are shaded red.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Month</label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((m) => (
                      <SelectItem key={m.v} value={String(m.v)}>{m.l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Year</label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button onClick={handleExport} disabled={exporting} className="flex-1">
                {exporting ? "Generating..." : "Download .xlsx"}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function DeleteLeaveModal({
  request,
  onClose,
  onConfirm,
  isPending,
}: {
  request: any;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <AnimatePresence>
      {request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-[440px] rounded-modal bg-card p-5 sm:p-6 shadow-modal mx-4"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive-light">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h2 className="font-heading text-lg font-bold text-ink-primary">
                  Delete leave permanently?
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  This will permanently remove the leave request for{" "}
                  <span className="font-medium text-ink-primary">
                    {request.employee?.full_name}
                  </span>
                  . This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 mb-5 text-xs text-ink-secondary space-y-1">
              <div>
                <span className="text-ink-muted">Type: </span>
                {request.leave_category === "casual_leave"
                  ? "Casual Leave"
                  : request.leave_category === "permission" || request.type === "permission"
                  ? "Permission"
                  : request.leave_category ?? request.type}
              </div>
              <div>
                <span className="text-ink-muted">Date: </span>
                {request.start_date && format(new Date(request.start_date), "MMM d, yyyy")}
                {request.end_date && request.end_date !== request.start_date &&
                  ` – ${format(new Date(request.end_date), "MMM d, yyyy")}`}
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1" disabled={isPending}>
                Cancel
              </Button>
              <Button
                onClick={onConfirm}
                disabled={isPending}
                className="flex-1 bg-destructive hover:bg-destructive/90 text-white gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                {isPending ? "Deleting..." : "Delete permanently"}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
