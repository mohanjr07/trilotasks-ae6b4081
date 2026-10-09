import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet, Plus, X, Paperclip, FileText, CheckCircle2, XCircle, Clock,
  ExternalLink, Loader2, Trash2, ShieldCheck,
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
import { openFileLink } from "@/lib/nativeFiles";

const BUCKET = "payment-bills";

type PaymentRequest = {
  id: string;
  requester_id: string;
  project_id: string | null;
  purpose: string;
  amount: number;
  bill_path: string;
  bill_name: string | null;
  status: "pending_verification" | "pending" | "approved" | "rejected";
  verifier_id: string | null;
  verified_at: string | null;
  paid_at?: string | null;
  paid_by?: string | null;
  receipt_path?: string | null;
  receipt_name?: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  requester?: { full_name: string; avatar_url: string | null } | null;
  project?: { name: string; color: string } | null;
};

const PAYER_EMAILS = ["anu@triloautomation.com"];

const formatINR = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function PaymentsPage() {
  const { profile, user } = useAuth();
  const qc = useQueryClient();

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const isAccountant = (profile?.department ?? "").trim().toLowerCase() === "accountant";
  // Anu pays out approved requests and marks them paid
  const isPayer = PAYER_EMAILS.includes((profile?.email ?? "").toLowerCase());
  const canSeeAll = isAdmin || isAccountant || isPayer;

  const [tab, setTab] = useState<"all" | "pending" | "approved" | "rejected" | "topay">("all");
  const [requestOpen, setRequestOpen] = useState(false);
  const [selected, setSelected] = useState<PaymentRequest | null>(null);
  const [rejectNote, setRejectNote] = useState<string | null>(null); // manager rejecting: reason being typed
  const [paying, setPaying] = useState(false);                       // Anu: receipt picker open
  const [receipt, setReceipt] = useState<File | null>(null);

  // everyone's names + roles (for the verifier dropdown and labels)
  const { data: people = [] } = useQuery({
    queryKey: ["payment-people"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_profiles");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string; role: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });
  const nameOf = (id?: string | null) => (id ? people.find((p) => p.id === id)?.full_name : undefined);
  const managers = people.filter((p) => p.role === "manager" && p.id !== user?.id)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["payment-requests", user?.id, canSeeAll],
    queryFn: async () => {
      let q = supabase
        .from("payment_requests")
        .select("*, requester:profiles!payment_requests_requester_id_fkey(full_name, avatar_url), project:projects(name, color)")
        .order("created_at", { ascending: false });
      // employees see their own requests + the ones they were asked to verify
      if (!canSeeAll) q = q.or(`requester_id.eq.${user!.id},verifier_id.eq.${user!.id}`);
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
    pending: requests.filter((r) => r.status === "pending" || r.status === "pending_verification").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  }), [requests]);

  const filtered = useMemo(
    () => requests.filter((r) => tab === "all" || r.status === tab || (tab === "pending" && r.status === "pending_verification")
      || (tab === "topay" && r.status === "approved" && !r.paid_at)),
    [requests, tab]
  );

  const openBill = async (path: string) => {
    try {
      await openFileLink(async () => {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
        if (error) throw error;
        return data.signedUrl;
      });
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

  const verifyMutation = useMutation({
    mutationFn: async ({ id, ok, note }: { id: string; ok: boolean; note?: string }) => {
      const { error } = await (supabase as any).rpc("verify_payment_request", { p_id: id, p_ok: ok, p_note: note ?? null });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      toast.success(vars.ok ? "Verified — sent to admins for approval" : "Payment request rejected");
      setRejectNote(null);
      setSelected(null);
    },
    onError: (e: any) => toast.error("Failed: " + (e?.message ?? "")),
  });
  const paidMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!receipt) throw new Error("Upload the payment receipt");
      const path = `receipts/${id}/${Date.now()}_${receipt.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, receipt, { contentType: receipt.type || undefined, upsert: false });
      if (upErr) throw upErr;
      const { error } = await (supabase as any).rpc("mark_payment_paid", { p_id: id, p_receipt_path: path, p_receipt_name: receipt.name });
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw error;
      }
    },
    onSuccess: () => {
      setPaying(false);
      setReceipt(null);
      qc.invalidateQueries({ queryKey: ["payment-requests"] });
      toast.success("Marked as paid — everyone involved has been notified");
      setSelected(null);
    },
    onError: (e: any) => toast.error("Could not update: " + (e?.message ?? "")),
  });

  const waitingForMe = requests.filter((r) => r.status === "pending_verification" && r.verifier_id === user?.id).length;

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
    { key: "pending" as const, label: `Pending (${stats.pending})${waitingForMe ? ` · ${waitingForMe} to verify` : ""}` },
    { key: "approved" as const, label: "Approved" },
    { key: "rejected" as const, label: "Rejected" },
    ...(isPayer || isAdmin || isAccountant
      ? [{ key: "topay" as const, label: `To pay (${requests.filter((r) => r.status === "approved" && !r.paid_at).length})` }] : []),
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

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
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
                {(canSeeAll || r.requester_id !== user?.id) && (
                  <UserAvatar name={r.requester?.full_name ?? nameOf(r.requester_id) ?? ""} avatarUrl={r.requester?.avatar_url} size="sm" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-ink-primary truncate">{r.purpose}</p>
                    <StatusBadge status={r.status} />
                    {r.paid_at ? (
                      <span className="inline-flex items-center rounded-full bg-success-light px-2.5 py-0.5 text-xs font-semibold text-success">₹ Paid</span>
                    ) : r.status === "approved" ? (
                      <span className="inline-flex items-center rounded-full bg-warning-light px-2.5 py-0.5 text-xs font-medium text-warning">Payment pending</span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                    {(canSeeAll || r.requester_id !== user?.id) && <span className="truncate">{r.requester?.full_name ?? nameOf(r.requester_id)}</span>}
                    {r.status === "pending_verification" && r.verifier_id && (
                      <span className="truncate">{r.verifier_id === user?.id ? "Waiting for your verification" : `Verifier: ${nameOf(r.verifier_id) ?? "—"}`}</span>
                    )}
                    {r.verified_at && r.verifier_id && (
                      <span className="truncate text-success">✓ Verified by {nameOf(r.verifier_id) ?? "—"}</span>
                    )}
                    {r.status === "approved" && r.reviewed_by && (
                      <span className="truncate text-success">✓ Approved by {nameOf(r.reviewed_by) ?? "—"}</span>
                    )}
                    {r.paid_at && (
                      <span className="truncate text-success">✓ Paid by {nameOf(r.paid_by) ?? "Accounts"}</span>
                    )}
                    {r.status === "rejected" && r.reviewed_by && (
                      <span className="truncate text-destructive">✗ Rejected by {nameOf(r.reviewed_by) ?? "—"}</span>
                    )}
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
        managers={managers}
        skipVerification={["manager", "admin", "super_admin"].includes(profile?.role ?? "")}
        userId={user?.id ?? ""}
        onDone={() => qc.invalidateQueries({ queryKey: ["payment-requests"] })}
      />

      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40" onClick={() => { setSelected(null); setRejectNote(null); setPaying(false); setReceipt(null); }}
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
                  <button onClick={() => { setSelected(null); setRejectNote(null); setPaying(false); setReceipt(null); }} className="text-ink-muted hover:text-ink-primary shrink-0">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                  <span className="text-sm text-ink-secondary">Amount</span>
                  <span className="font-heading text-lg font-bold text-ink-primary">{formatINR(selected.amount)}</span>
                </div>

                <div className="space-y-2 text-sm">
                  {(canSeeAll || selected.requester_id !== user?.id) && (
                    <div className="flex items-center justify-between">
                      <span className="text-ink-muted">Requested by</span>
                      <span className="text-ink-primary font-medium">{selected.requester?.full_name ?? nameOf(selected.requester_id) ?? "—"}</span>
                    </div>
                  )}
                  {selected.verifier_id && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink-muted">Verified by</span>
                      <span className="text-ink-primary font-medium text-right">
                        {nameOf(selected.verifier_id) ?? "—"}
                        <span className="block text-xs font-normal text-ink-muted">
                          {selected.verified_at ? `✓ Verified ${format(new Date(selected.verified_at), "MMM d, h:mm a")}`
                            : selected.status === "pending_verification" ? "Waiting for verification"
                            : selected.status === "rejected" && selected.reviewed_by === selected.verifier_id ? "Rejected" : ""}
                        </span>
                      </span>
                    </div>
                  )}
                  {(selected.status === "approved" || (selected.status === "rejected" && selected.reviewed_by !== selected.verifier_id)) && selected.reviewed_by && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink-muted">{selected.status === "approved" ? "Approved by" : "Rejected by"}</span>
                      <span className="text-ink-primary font-medium text-right">
                        {nameOf(selected.reviewed_by) ?? "—"}
                        {selected.reviewed_at && (
                          <span className="block text-xs font-normal text-ink-muted">{format(new Date(selected.reviewed_at), "MMM d, h:mm a")}</span>
                        )}
                      </span>
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
                  {selected.status === "approved" && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink-muted">Payment</span>
                      {selected.paid_at ? (
                        <span className="text-right font-medium text-success">
                          ✓ Payment done
                          <span className="block text-xs font-normal text-ink-muted">
                            by {nameOf(selected.paid_by) ?? "Accounts"} · {format(new Date(selected.paid_at), "MMM d, h:mm a")}
                          </span>
                        </span>
                      ) : (
                        <span className="text-right font-medium text-warning">Not paid yet</span>
                      )}
                    </div>
                  )}
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

                {selected.receipt_path && (
                  <button
                    onClick={() => openBill(selected.receipt_path!)}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-success/40 bg-success-light px-4 py-2.5 text-sm font-medium text-success hover:opacity-90 transition-opacity"
                  >
                    <FileText className="h-4 w-4" /> View payment receipt <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                )}

                {isPayer && selected.status === "approved" && !selected.paid_at && (
                  !paying ? (
                    <Button className="w-full gap-1.5 bg-success hover:bg-success/90 text-white" onClick={() => setPaying(true)}>
                      <CheckCircle2 className="h-4 w-4" /> Payment done
                    </Button>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-border p-3">
                      <p className="text-xs font-medium text-ink-muted">Upload the payment receipt *</p>
                      <div className="relative">
                        <label className="flex items-center gap-2 w-full text-sm rounded-md border border-dashed border-border bg-background px-3 py-3 pr-10 cursor-pointer hover:bg-muted/40 transition-colors">
                          <Paperclip className="h-4 w-4 text-ink-muted shrink-0" />
                          <span className="truncate text-ink-secondary">{receipt ? receipt.name : "Tap to choose a photo or PDF of the receipt"}</span>
                          <input type="file" accept="image/*,.pdf" className="hidden"
                            onChange={(e) => { setReceipt(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                        </label>
                        {receipt && (
                          <button type="button" onClick={() => setReceipt(null)} aria-label="Remove receipt"
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-muted hover:text-destructive hover:bg-destructive/10">
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" disabled={paidMutation.isPending}
                          onClick={() => { setPaying(false); setReceipt(null); }}>Cancel</Button>
                        <Button className="flex-1 gap-1.5 bg-success hover:bg-success/90 text-white" disabled={!receipt || paidMutation.isPending}
                          onClick={() => paidMutation.mutate(selected.id)}>
                          {paidMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          {paidMutation.isPending ? "Saving…" : "Confirm payment"}
                        </Button>
                      </div>
                    </div>
                  )
                )}

                {selected.status === "pending_verification" && selected.verifier_id === user?.id && (
                  rejectNote === null ? (
                    <div className="flex gap-3 pt-2">
                      <Button variant="outline" className="flex-1 gap-1.5" disabled={verifyMutation.isPending}
                        onClick={() => setRejectNote("")}>
                        <XCircle className="h-4 w-4" /> Reject
                      </Button>
                      <Button className="flex-1 gap-1.5" disabled={verifyMutation.isPending}
                        onClick={() => verifyMutation.mutate({ id: selected.id, ok: true })}>
                        <ShieldCheck className="h-4 w-4" /> Verified
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-2">
                      <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={2}
                        placeholder="Why is this bill being rejected?" autoFocus />
                      <div className="flex gap-3">
                        <Button variant="outline" className="flex-1" onClick={() => setRejectNote(null)}>Cancel</Button>
                        <Button variant="destructive" className="flex-1" disabled={!rejectNote.trim() || verifyMutation.isPending}
                          onClick={() => verifyMutation.mutate({ id: selected.id, ok: false, note: rejectNote })}>
                          Reject
                        </Button>
                      </div>
                    </div>
                  )
                )}

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
  open, onClose, projects, managers, skipVerification, userId, onDone,
}: {
  skipVerification: boolean;   // managers / admins: straight to the admins
  open: boolean;
  onClose: () => void;
  projects: { id: string; name: string }[];
  managers: { id: string; full_name: string }[];
  userId: string;
  onDone: () => void;
}) {
  const [projectId, setProjectId] = useState<string>("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [verifierId, setVerifierId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setProjectId("");
    setPurpose("");
    setAmount("");
    setFile(null);
    setVerifierId("");
  };

  const handleSubmit = async () => {
    if (!purpose.trim()) return toast.error("Enter the purpose of this payment");
    if (!amount || Number(amount) <= 0) return toast.error("Enter a valid amount");
    if (!file) return toast.error("Attach the bill");
    if (!skipVerification && !verifierId) return toast.error("Choose the manager who will verify the bill");
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
        verifier_id: skipVerification ? null : verifierId,
        status: skipVerification ? "pending" : "pending_verification",
      } as any);
      if (insErr) {
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw insErr;
      }

      toast.success(skipVerification ? "Payment request sent to the admins for approval"
        : `Sent to ${managers.find((m) => m.id === verifierId)?.full_name ?? "the manager"} for verification`);
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
                  <div className="relative">
                    <label className="flex items-center gap-2 w-full text-sm rounded-md border border-dashed border-border bg-background px-3 py-3 pr-10 cursor-pointer hover:bg-muted/40 transition-colors">
                      <Paperclip className="h-4 w-4 text-ink-muted shrink-0" />
                      <span className="truncate text-ink-secondary">
                        {file ? file.name : "Tap to choose a photo or PDF of the bill"}
                      </span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
                      />
                    </label>
                    {file && (
                      <button
                        type="button"
                        onClick={() => setFile(null)}
                        disabled={submitting}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-muted hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                        title="Remove attachment"
                        aria-label="Remove attachment"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {!skipVerification && (
                <div>
                  <label className="text-xs font-medium text-ink-muted mb-1.5 block">Payment verification by *</label>
                  <Select value={verifierId} onValueChange={setVerifierId}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="Choose a manager" /></SelectTrigger>
                    <SelectContent>
                      {managers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-ink-muted">They check the bill first; then it goes to the admins for approval.</p>
                </div>
                )}
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
