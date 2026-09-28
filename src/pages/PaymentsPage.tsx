import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet, Plus, X, Paperclip, FileText, CheckCircle2, XCircle, Clock,
  ExternalLink, Loader2, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import StatusBadge from "@/components/StatusBadge";
import StatCard from "@/components/StatCard";
import UserAvatar from "@/components/UserAvatar";
import { toast } from "sonner";
import { format } from "date-fns";

const BUCKET = "payment-bills";

type PaymentRequest = {
  id: string;
  requester_id: string;
  project_id: string | null;
  purpose: string;
  amount: number;
  bill_path: string;
  bill_name: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  requester?: { full_name: string; avatar_url: string | null } | null;
  project?: { name: string; color: string } | null;
};

const formatINR = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function PaymentsPage() {
  const { profile, user } = useAuth();
  const qc = useQueryClient();

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const isAccountant = (profile?.department ?? "").trim().toLowerCase() === "accountant";
  const canSeeAll = isAdmin || isAccountant;

  const [tab, setTab] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [requestOpen, setRequestOpen] = useState(false);
  const [selected, setSelected] = useState<PaymentRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["payment-requests", user?.id, canSeeAll],
    queryFn: async () => {
      let q = supabase
        .from("payment_requests")
        .select("*, requester:profiles!payment_requests_requester_id_fkey(full_name, avatar_url), project:projects(name, color)")
        .order("created_at", { ascending: false });
      if (!canSeeAll) q = q.eq("requester_id", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PaymentRequest[];
    },
    enabled: !!user,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  }), [requests]);

  const filtered = useMemo(
    () => requests.filter((r) => tab === "all" || r.status === tab),
    [requests, tab]
  );

  const openBill = async (path: string) => {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error("Could not open the bill: " + (e?.message ?? ""));
    }
  };

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: "approved" | "rejected"; note?: string }) => {
      const { error } = await supabase
        .from("payment_requests")
        .update({ status, reviewed_by: user!.id, reviewed_at: new Date().toISOString(), review_note: note ?? null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      toast.success(vars.status === "approved" ? "Payment request approved" : "Payment request rejected");
      setSelected(null);
    },
    onError: (e: any) => toast.error("Failed to update: " + (e?.message ?? "")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (r: PaymentRequest) => {
      const { data, error } = await supabase.from("payment_requests").delete().eq("id", r.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("not allowed (run the admin-delete SQL in Supabase)");
      if (r.bill_path) await supabase.storage.from(BUCKET).remove([r.bill_path]).catch(() => {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      toast.success("Payment request deleted");
      setSelected(null);
    },
    onError: (e: any) => toast.error("Failed to delete: " + (e?.message ?? "")),
  });

  const confirmDelete = (r: PaymentRequest) => {
    if (window.confirm(`Delete "${r.purpose}" (${formatINR(r.amount)})? This cannot be undone.`)) {
      deleteMutation.mutate(r);
    }
  };

  const tabs = [
    { key: "all" as const, label: "All" },
    { key: "pending" as const, label: `Pending (${stats.pending})` },
    { key: "approved" as const, label: "Approved" },
    { key: "rejected" as const, label: "Rejected" },
  ];

  return (
    <AnimatedPage>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="font-heading text-xl sm:text-[28px] font-bold text-ink-primary">Payments</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {canSeeAll ? "Review and track payment requests across the team." : "Request a payment and track its approval."}
          </p>
        </div>
        <Button onClick={() => setRequestOpen(true)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Request Payment
        </Button>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total Requests" value={stats.total} icon={Wallet} />
        <StatCard title="Pending" value={stats.pending} icon={Clock} iconBg="bg-warning-light" iconColor="text-warning" />
        <StatCard title="Approved" value={stats.approved} icon={CheckCircle2} iconBg="bg-success-light" iconColor="text-success" />
        <StatCard title="Rejected" value={stats.rejected} icon={XCircle} iconBg="bg-destructive-light" iconColor="text-destructive" />
      </motion.div>

      {/* Filter — Select on mobile, tab strip on larger screens */}
      <div className="mb-4">
        <div className="sm:hidden">
          <Select value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <SelectTrigger className="h-9 text-xs w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {tabs.map((t) => (
                <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="hidden sm:flex gap-1 border-b border-border overflow-x-auto no-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${tab === t.key ? "text-primary" : "text-ink-muted hover:text-ink-secondary"}`}
            >
              {t.label}
              {tab === t.key && (
                <motion.div layoutId="payments-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={requests.length === 0 ? "No payment requests yet" : "Nothing here"}
          description={
            requests.length === 0
              ? "Attach a bill, pick a project, and submit your first request."
              : "Try a different filter."
          }
          actionLabel={requests.length === 0 ? "Request Payment" : undefined}
          onAction={requests.length === 0 ? () => setRequestOpen(true) : undefined}
        />
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
          {filtered.map((r) => (
            <motion.div
              key={r.id}
              variants={staggerItem}
              onClick={() => setSelected(r)}
              className="rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-start gap-3">
                {canSeeAll && (
                  <UserAvatar name={r.requester?.full_name ?? ""} avatarUrl={r.requester?.avatar_url} size="sm" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-ink-primary truncate">{r.purpose}</p>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                    {canSeeAll && <span className="truncate">{r.requester?.full_name}</span>}
                    {r.project?.name && <span className="truncate">{r.project.name}</span>}
                    <span>{format(new Date(r.created_at), "MMM d, yyyy")}</span>
                  </div>
                </div>
                <p className="shrink-0 font-heading text-base font-bold text-ink-primary">{formatINR(r.amount)}</p>
                {isAdmin && (
                  <button
                    onClick={(e) => { e.stopPropagation(); confirmDelete(r); }}
                    disabled={deleteMutation.isPending}
                    className="shrink-0 -mr-1 rounded-md p-1.5 text-ink-muted hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    title="Delete request"
                    aria-label="Delete request"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <RequestPaymentModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        projects={projects}
        userId={user?.id ?? ""}
        onDone={() => qc.invalidateQueries({ queryKey: ["payment-requests"] })}
      />

      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40" onClick={() => setSelected(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[85vh] overflow-y-auto">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-ink-primary truncate">{selected.purpose}</h3>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {format(new Date(selected.created_at), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-ink-muted hover:text-ink-primary shrink-0">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                  <span className="text-sm text-ink-secondary">Amount</span>
                  <span className="font-heading text-lg font-bold text-ink-primary">{formatINR(selected.amount)}</span>
                </div>

                <div className="space-y-2 text-sm">
                  {canSeeAll && (
                    <div className="flex items-center justify-between">
                      <span className="text-ink-muted">Requested by</span>
                      <span className="text-ink-primary font-medium">{selected.requester?.full_name ?? "—"}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Project</span>
                    <span className="text-ink-primary font-medium truncate max-w-[200px]">{selected.project?.name ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Status</span>
                    <StatusBadge status={selected.status} />
                  </div>
                  {selected.review_note && (
                    <div className="pt-1">
                      <span className="text-ink-muted">Note: </span>
                      <span className="text-ink-primary">{selected.review_note}</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => openBill(selected.bill_path)}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm font-medium text-ink-primary hover:bg-muted transition-colors"
                >
                  <FileText className="h-4 w-4" /> View attached bill <ExternalLink className="h-3.5 w-3.5" />
                </button>

                {isAdmin && selected.status === "pending" && (
                  <div className="flex gap-3 pt-2">
                    <Button
                      variant="outline"
                      className="flex-1 gap-1.5"
                      disabled={reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ id: selected.id, status: "rejected" })}
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                    <Button
                      className="flex-1 gap-1.5"
                      disabled={reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ id: selected.id, status: "approved" })}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </Button>
                  </div>
                )}

                {isAdmin && (
                  <Button
                    variant="outline"
                    className="w-full gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => confirmDelete(selected)}
                  >
                    <Trash2 className="h-4 w-4" /> {deleteMutation.isPending ? "Deleting..." : "Delete request"}
                  </Button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </AnimatedPage>
  );
}

// ─── Request Payment Modal ─────────────────────────────────────────────────
function RequestPaymentModal({
  open, onClose, projects, userId, onDone,
}: {
  open: boolean;
  onClose: () => void;
  projects: { id: string; name: string }[];
  userId: string;
  onDone: () => void;
}) {
  const [projectId, setProjectId] = useState<string>("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setProjectId("");
    setPurpose("");
    setAmount("");
    setFile(null);
  };

  const handleSubmit = async () => {
    if (!purpose.trim()) return toast.error("Enter the purpose of this payment");
    if (!amount || Number(amount) <= 0) return toast.error("Enter a valid amount");
    if (!file) return toast.error("Attach the bill");
    if (!userId) return toast.error("You must be logged in");

    setSubmitting(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("payment_requests").insert({
        requester_id: userId,
        project_id: projectId || null,
        purpose: purpose.trim(),
        amount: Number(amount),
        bill_path: path,
        bill_name: file.name,
      });
      if (insErr) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw insErr;
      }

      toast.success("Payment request sent for approval");
      reset();
      onDone();
      onClose();
    } catch (e: any) {
      toast.error("Could not submit request: " + (e?.message ?? ""));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40" onClick={() => !submitting && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-ink-primary">Request Payment</h3>
                <button disabled={submitting} onClick={onClose} className="text-ink-muted hover:text-ink-primary disabled:opacity-50">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-ink-muted mb-1.5 block">Project</label>
                  <Select
                    value={projectId || "none"}
                    onValueChange={(v) => setProjectId(v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="h-10"><SelectValue placeholder="Select a project" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No specific project</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-xs font-medium text-ink-muted mb-1.5 block">Purpose *</label>
                  <Textarea
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="What is this payment for?"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-ink-muted mb-1.5 block">Amount (₹) *</label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="h-10"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-ink-muted mb-1.5 block">Attach bill *</label>
                  <label className="flex items-center gap-2 w-full text-sm rounded-md border border-dashed border-border bg-background px-3 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
                    <Paperclip className="h-4 w-4 text-ink-muted shrink-0" />
                    <span className="truncate text-ink-secondary">
                      {file ? file.name : "Tap to choose a photo or PDF of the bill"}
                    </span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              </div>

              <Button onClick={handleSubmit} disabled={submitting} className="w-full gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {submitting ? "Submitting…" : "Request"}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
