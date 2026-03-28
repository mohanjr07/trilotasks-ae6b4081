import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, CheckCircle2, XCircle, Clock, Calendar as CalendarIcon, X } from "lucide-react";
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
import { toast } from "sonner";

export default function AdminLeavePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [reviewReq, setReviewReq] = useState<any>(null);

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
    if (tab !== "all" && r.status !== tab) return false;
    if (search && !r.employee?.full_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const pending = requests.filter((r: any) => r.status === "pending").length;
  const approved = requests.filter((r: any) => r.status === "approved").length;
  const rejected = requests.filter((r: any) => r.status === "rejected").length;

  const tabs = [
    { key: "all", label: "All" },
    { key: "pending", label: `Pending (${pending})` },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">
          Leave & Permissions {pending > 0 && <span className="text-sm font-body bg-warning-light text-warning px-2 py-0.5 rounded-pill ml-2">{pending} pending</span>}
        </h1>
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
        {filtered.map((req: any) => (
          <motion.div key={req.id} variants={staggerItem}
            className="flex items-center gap-4 rounded-card bg-card p-4 shadow-card hover:shadow-card-hover transition-shadow">
            <UserAvatar name={req.employee?.full_name ?? "?"} avatarUrl={req.employee?.avatar_url} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-primary">{req.employee?.full_name}</p>
              <p className="text-xs text-ink-muted">
                <span className="capitalize">{req.type}</span>
                {req.leave_category && ` · ${req.leave_category}`}
                {" · "}
                {req.start_date && format(new Date(req.start_date), "MMM d")}
                {req.end_date && req.end_date !== req.start_date && `–${format(new Date(req.end_date), "MMM d")}`}
              </p>
            </div>
            <StatusBadge status={req.status ?? "pending"} />
            {req.status === "pending" && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-success border-success/30 hover:bg-success-light"
                  onClick={() => setReviewReq({ ...req, action: "approved" })}>✓</Button>
                <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive-light"
                  onClick={() => setReviewReq({ ...req, action: "rejected" })}>✗</Button>
              </div>
            )}
            {req.status !== "pending" && (
              <Button size="sm" variant="ghost" className="text-ink-muted hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); clearRequest.mutate(req.id); }}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </motion.div>
        ))}
        {filtered.length === 0 && <div className="py-16 text-center text-sm text-ink-muted">No requests found</div>}
      </motion.div>

      <ReviewModal request={reviewReq} onClose={() => setReviewReq(null)} />
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
