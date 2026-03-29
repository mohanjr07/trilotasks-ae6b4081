import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Calendar as CalendarIcon } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import StatusBadge from "@/components/StatusBadge";
import StatCard from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { X, CheckCircle2, Clock, XCircle } from "lucide-react";

export default function EmployeeLeavePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState("all");

  const { data: requests = [] } = useQuery({
    queryKey: ["my-leave", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("leave_requests").select("*").eq("employee_id", user!.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const filtered = requests.filter((r: any) => {
    if (tab === "all") return true;
    if (tab === "casual_leave" || tab === "on_duty" || tab === "unauthorised_leave") return r.leave_category === tab;
    return r.status === tab;
  });

  const approved = requests.filter((r: any) => r.status === "approved").length;
  const pending = requests.filter((r: any) => r.status === "pending").length;

  const tabs = [
    { key: "all", label: "All" },
    { key: "casual_leave", label: "Casual" },
    { key: "on_duty", label: "On Duty" },
    { key: "unauthorised_leave", label: "Unauthorised" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">Leave & Permissions</h1>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New Request
        </Button>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-3 gap-4 mb-6">
        <StatCard title="Approved" value={approved} icon={CheckCircle2} iconBg="bg-success-light" iconColor="text-success" />
        <StatCard title="Pending" value={pending} icon={Clock} iconBg="bg-warning-light" iconColor="text-warning" />
        <StatCard title="Total" value={requests.length} icon={CalendarIcon} />
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${tab === t.key ? "text-primary" : "text-ink-muted hover:text-ink-secondary"}`}>
            {t.label}
            {tab === t.key && <motion.div layoutId="leave-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
        {filtered.map((req: any) => (
          <motion.div key={req.id} variants={staggerItem}
            className="rounded-card bg-card p-4 shadow-card border-l-4"
            style={{ borderLeftColor: req.status === "pending" ? "hsl(32,95%,44%)" : req.status === "approved" ? "hsl(142,72%,39%)" : "hsl(0,72%,51%)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex gap-2 mb-1">
                  <span className="text-xs font-medium bg-accent-light text-primary px-2 py-0.5 rounded-pill capitalize">
                    {req.leave_category === "casual_leave" ? "Casual Leave" : req.leave_category === "on_duty" ? "On Duty" : req.leave_category === "unauthorised_leave" ? "Unauthorised Leave" : req.leave_category ?? req.type}
                  </span>
                </div>
                <p className="text-sm text-ink-primary font-medium">
                  {req.start_date && format(new Date(req.start_date), "MMM d, yyyy")}
                  {req.end_date && req.end_date !== req.start_date && ` — ${format(new Date(req.end_date), "MMM d, yyyy")}`}
                  {req.start_time && ` · ${req.start_time}–${req.end_time}`}
                </p>
                <p className="text-xs text-ink-muted mt-1">{req.reason}</p>
                {req.admin_note && req.status === "rejected" && (
                  <div className="mt-2 rounded-lg bg-destructive-light px-3 py-2 text-xs text-destructive">{req.admin_note}</div>
                )}
              </div>
              <StatusBadge status={req.status ?? "pending"} />
            </div>
          </motion.div>
        ))}
        {filtered.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-muted">No requests found</div>
        )}
      </motion.div>

      <NewLeaveModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </AnimatedPage>
  );
}

function NewLeaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("casual_leave");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  // Check how many casual leave days were approved this month
  const { data: approvedCasualDays = 0 } = useQuery({
    queryKey: ["casual-leave-usage", user?.id],
    queryFn: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("leave_requests")
        .select("start_date, end_date")
        .eq("employee_id", user!.id)
        .eq("type", "leave")
        .eq("leave_category", "casual_leave")
        .eq("status", "approved")
        .gte("start_date", monthStart)
        .lte("start_date", monthEnd);
      if (!data) return 0;
      let total = 0;
      data.forEach((r: any) => {
        const s = new Date(r.start_date);
        const e = r.end_date ? new Date(r.end_date) : s;
        total += Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
      });
      return total;
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const casualDisabled = approvedCasualDays >= 2;

  // Auto-switch away from casual if disabled
  const effectiveCategory = casualDisabled && category === "casual_leave" ? "on_duty" : category;

  const submit = useMutation({
    mutationFn: async () => {
      const payload: any = {
        employee_id: user!.id,
        type: "leave",
        reason,
        start_date: startDate,
        end_date: endDate || startDate,
        leave_category: effectiveCategory,
      };
      const { error } = await supabase.from("leave_requests").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-leave"] });
      queryClient.invalidateQueries({ queryKey: ["casual-leave-usage"] });
      toast.success("Request submitted successfully");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const categories = [
    { value: "casual_leave", label: "Casual Leave", disabled: casualDisabled, hint: casualDisabled ? `Limit reached (${approvedCasualDays}/2 days this month)` : `${2 - approvedCasualDays} day(s) remaining this month` },
    { value: "on_duty", label: "On Duty", disabled: false },
    { value: "unauthorised_leave", label: "Unauthorised Leave", disabled: false },
  ];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
            className="relative w-full md:max-w-[500px] rounded-t-modal md:rounded-modal bg-card p-6 shadow-modal"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-heading text-xl font-bold text-ink-primary">New Leave Request</h2>
              <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Leave Type</label>
                <Select value={effectiveCategory} onValueChange={setCategory}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.value} value={c.value} disabled={c.disabled}>
                        {c.label}{c.disabled ? " (Limit reached)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categories.find(c => c.value === effectiveCategory)?.hint && (
                  <p className="mt-1 text-xs text-ink-muted">{categories.find(c => c.value === effectiveCategory)?.hint}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Start Date</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">End Date</label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10" />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Reason</label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Explain your reason..." />
              </div>
              <Button onClick={() => submit.mutate()} disabled={submit.isPending || !startDate || !reason} className="w-full h-11">
                {submit.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}