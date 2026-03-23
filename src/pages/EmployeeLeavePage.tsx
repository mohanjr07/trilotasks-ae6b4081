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
    if (tab === "leave" || tab === "permission") return r.type === tab;
    return r.status === tab;
  });

  const approved = requests.filter((r: any) => r.status === "approved").length;
  const pending = requests.filter((r: any) => r.status === "pending").length;

  const tabs = [
    { key: "all", label: "All" },
    { key: "leave", label: "Leave" },
    { key: "permission", label: "Permission" },
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
                  <span className="text-xs font-medium bg-accent-light text-primary px-2 py-0.5 rounded-pill capitalize">{req.type}</span>
                  {req.leave_category && <span className="text-xs text-ink-muted capitalize">{req.leave_category}</span>}
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
  const [type, setType] = useState<"leave" | "permission">("leave");
  const [category, setCategory] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const payload: any = {
        employee_id: user!.id,
        type,
        reason,
        start_date: startDate,
      };
      if (type === "leave") {
        payload.leave_category = category;
        payload.end_date = endDate;
      } else {
        payload.start_time = startTime;
        payload.end_time = endTime;
      }
      const { error } = await supabase.from("leave_requests").insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-leave"] });
      toast.success("Request submitted successfully");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

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
              <h2 className="font-heading text-xl font-bold text-ink-primary">New Request</h2>
              <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {(["leave", "permission"] as const).map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`rounded-lg border p-4 text-center text-sm font-medium transition-all ${type === t ? "border-primary bg-accent-light text-primary" : "border-border text-ink-secondary"}`}>
                  {t === "leave" ? "🏖 Leave" : "⏰ Permission"}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {type === "leave" && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Category</label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["annual", "sick", "emergency", "unpaid", "other"].map((c) => (
                        <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className={type === "leave" ? "grid grid-cols-2 gap-3" : ""}>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">{type === "leave" ? "Start Date" : "Date"}</label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-10" />
                </div>
                {type === "leave" && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-primary">End Date</label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-10" />
                  </div>
                )}
              </div>
              {type === "permission" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-primary">Start Time</label>
                    <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-10" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-ink-primary">End Time</label>
                    <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-10" />
                  </div>
                </div>
              )}
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
