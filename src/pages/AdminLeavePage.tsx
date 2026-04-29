import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, CheckCircle2, XCircle, Clock, Calendar as CalendarIcon, X, Plus, RotateCcw, FileSpreadsheet } from "lucide-react";
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

export default function AdminLeavePage() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const isStrictAdmin = profile?.role === "admin";
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [reviewReq, setReviewReq] = useState<any>(null);
  const [showAssignLeave, setShowAssignLeave] = useState(false);
  const [showExport, setShowExport] = useState(false);

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
        .select("*, employee:profiles!leave_requests_employee_id_fkey(full_name, avatar_url, department)")
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
  ];

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">
          Leave & Permissions {pending > 0 && <span className="text-sm font-body bg-warning-light text-warning px-2 py-0.5 rounded-pill ml-2">{pending} pending</span>}
        </h1>
        {isStrictAdmin && (
          <div className="flex gap-2">
            <Button onClick={() => setShowExport(true)} size="sm" variant="outline">
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export to Excel
            </Button>
            <Button onClick={() => setShowAssignLeave(true)} size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Assign Leave
            </Button>
          </div>
        )}
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total" value={requests.length} icon={CalendarIcon} />
        <StatCard title="Approved" value={approved} icon={CheckCircle2} iconBg="bg-success-light" iconColor="text-success" />
        <StatCard title="Rejected" value={rejected} icon={XCircle} iconBg="bg-destructive-light" iconColor="text-destructive" />
        <StatCard title="Pending" value={pending} icon={Clock} iconBg="bg-warning-light" iconColor="text-warning" />
      </motion.div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex gap-1 border-b border-border flex-1 min-w-[200px]">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? "text-primary" : "text-ink-muted hover:text-ink-secondary"}`}>
              {t.label}
              {tab === t.key && <motion.div layoutId="admin-leave-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>
        <div className="relative w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee..." className="pl-9 h-9" />
        </div>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
        {filtered.map((req: any) => {
          const isReverted = !!req.reverted_at;
          const displayStatus = isReverted ? "reverted" : (req.status ?? "pending");
          return (
          <motion.div key={req.id} variants={staggerItem}
            className={`flex items-center gap-4 rounded-card bg-card p-4 shadow-card hover:shadow-card-hover transition-shadow ${isReverted ? "opacity-70" : ""}`}>
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
          </motion.div>
          );
        })}
        {filtered.length === 0 && <div className="py-16 text-center text-sm text-ink-muted">No requests found</div>}
      </motion.div>

      <ReviewModal request={reviewReq} onClose={() => setReviewReq(null)} />
      {isStrictAdmin && <AssignLeaveModal open={showAssignLeave} onClose={() => setShowAssignLeave(false)} />}
      {isStrictAdmin && <ExportLeaveModal open={showExport} onClose={() => setShowExport(false)} />}
    </AnimatedPage>
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
          className="relative w-full max-w-[460px] rounded-modal bg-card p-6 shadow-modal mx-4">
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
  // "Late" sub-options — only used when leaveCategory === "late"
  const [lateDuration, setLateDuration] = useState<"full" | "half">("half");
  const [lateHalfPeriod, setLateHalfPeriod] = useState<"AM" | "PM">("AM");
  // "Permission" time range — only used when leaveCategory === "permission"
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const isLate = leaveCategory === "late";
  const isLateHalfDay = isLate && lateDuration === "half";
  const isPermission = leaveCategory === "permission";

  const resetForm = () => {
    setEmployeeId("");
    setLeaveCategory("casual_leave");
    setStartDate("");
    setEndDate("");
    setReason("");
    setLateDuration("half");
    setLateHalfPeriod("AM");
    setStartTime("");
    setEndTime("");
  };

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
        end_date: isLateHalfDay || isPermission ? startDate : endDate || startDate,
        reason: reason.trim(),
        status: "approved",
        reviewed_by: user!.id,
        reviewed_at: new Date().toISOString(),
      };
      if (isLateHalfDay) {
        payload.is_half_day = true;
        payload.half_day_period = lateHalfPeriod; // AM = First Half, PM = Second Half
      }
      if (isPermission) {
        payload.start_time = startTime;
        payload.end_time = endTime;
      }
      const { error } = await supabase.from("leave_requests").insert([payload]);
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
            className="relative w-full max-w-[460px] rounded-modal bg-card p-6 shadow-modal mx-4">
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

              {isLate && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ink-secondary">Late Duration *</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setLateDuration("full")}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                          lateDuration === "full"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-ink-secondary hover:bg-muted"
                        }`}
                      >
                        Full Day
                      </button>
                      <button
                        type="button"
                        onClick={() => setLateDuration("half")}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                          lateDuration === "half"
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-ink-secondary hover:bg-muted"
                        }`}
                      >
                        Half Day
                      </button>
                    </div>
                  </div>

                  {lateDuration === "half" && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-secondary">Half Day Period *</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setLateHalfPeriod("AM")}
                          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            lateHalfPeriod === "AM"
                              ? "border-primary bg-accent-light text-primary"
                              : "border-border bg-card text-ink-secondary hover:bg-muted"
                          }`}
                        >
                          First Half
                        </button>
                        <button
                          type="button"
                          onClick={() => setLateHalfPeriod("PM")}
                          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            lateHalfPeriod === "PM"
                              ? "border-primary bg-accent-light text-primary"
                              : "border-border bg-card text-ink-secondary hover:bg-muted"
                          }`}
                        >
                          Second Half
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11px] text-ink-muted">
                        Employee will be marked as half-day leave for the {lateHalfPeriod === "AM" ? "first" : "second"} half of the day.
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
                      {isLateHalfDay ? "Date *" : "Start Date *"}
                    </label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-primary">End Date</label>
                    <Input
                      type="date"
                      value={isLateHalfDay ? "" : endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      disabled={isLateHalfDay}
                      placeholder={isLateHalfDay ? "Not used for half-day" : undefined}
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
      // Active employees in alphabetical order (mirrors the paper sheet's S.No layout)
      const empRes = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name");
      if (empRes.error) throw empRes.error;
      const employees = (empRes.data ?? []) as Array<{ id: string; full_name: string }>;

      // Bound the leave query to the chosen month so we don't ship the whole table
      const monthStart = new Date(year, month - 1, 1).toISOString().slice(0, 10);
      const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
      // A request "touches" this month if start_date <= monthEnd AND end_date >= monthStart
      const reqRes = await supabase
        .from("leave_requests")
        .select("employee_id, start_date, end_date, reverted_at, status, type, leave_category, is_half_day, half_day_period")
        .lte("start_date", monthEnd)
        .gte("end_date", monthStart);
      if (reqRes.error) {
        // Fallback if reverted_at column doesn't exist yet — re-query without it
        if (reqRes.error.code === "42703" || (reqRes.error.message ?? "").includes("reverted_at")) {
          const fallback = await supabase
            .from("leave_requests")
            .select("employee_id, start_date, end_date, status, type, leave_category, is_half_day, half_day_period")
            .lte("start_date", monthEnd)
            .gte("end_date", monthStart);
          if (fallback.error) throw fallback.error;
          await exportLeavesToExcel({ year, month, employees, leaveRequests: fallback.data ?? [] });
        } else {
          throw reqRes.error;
        }
      } else {
        await exportLeavesToExcel({ year, month, employees, leaveRequests: reqRes.data ?? [] });
      }
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
            className="relative w-full max-w-[420px] rounded-modal bg-card p-6 shadow-modal mx-4">
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
