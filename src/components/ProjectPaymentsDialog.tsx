// Admins: what a project has cost — overall spend + every payment request logged against it.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Receipt, Loader2, IndianRupee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openFileLink } from "@/lib/nativeFiles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

const BUCKET = "payment-bills";
export const formatINR = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Row = {
  id: string; purpose: string; amount: number; status: string; created_at: string;
  requester_id: string; verifier_id: string | null; reviewed_by: string | null;
  paid_at: string | null; paid_by: string | null; bill_path: string; receipt_path: string | null;
};

/** Approved requests count as spend (paid or still to be paid). */
export const isSpend = (status: string) => status === "approved";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_verification: { label: "Waiting for verification", cls: "bg-warning-light text-warning" },
  pending: { label: "Waiting for approval", cls: "bg-warning-light text-warning" },
  approved: { label: "Approved", cls: "bg-success-light text-success" },
  rejected: { label: "Rejected", cls: "bg-destructive-light text-destructive" },
};

export default function ProjectPaymentsDialog({ project, onClose }: {
  project: { id: string; name: string; color: string } | null; onClose: () => void;
}) {
  const [filter, setFilter] = useState<"spend" | "pending" | "rejected" | "all">("spend");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["project-payments", project?.id],
    enabled: !!project,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payment_requests")
        .select("id, purpose, amount, status, created_at, requester_id, verifier_id, reviewed_by, paid_at, paid_by, bill_path, receipt_path")
        .eq("project_id", project!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: names = {} } = useQuery({
    queryKey: ["profile-names"],
    enabled: !!project,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name");
      return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.full_name])) as Record<string, string>;
    },
  });

  const sum = (list: Row[]) => list.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totals = useMemo(() => {
    const spend = rows.filter((r) => isSpend(r.status));
    return {
      spend: sum(spend),
      paid: sum(spend.filter((r) => r.paid_at)),
      toPay: sum(spend.filter((r) => !r.paid_at)),
      pending: sum(rows.filter((r) => r.status === "pending" || r.status === "pending_verification")),
      count: spend.length,
    };
  }, [rows]);

  const shown = rows.filter((r) =>
    filter === "all" ? true
      : filter === "spend" ? isSpend(r.status)
      : filter === "pending" ? r.status === "pending" || r.status === "pending_verification"
      : r.status === "rejected");

  const openFile = async (path: string) => {
    try {
      await openFileLink(async () => {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
        if (error) throw error;
        return data.signedUrl;
      });
    } catch (e: any) {
      toast.error("Could not open the file: " + (e?.message ?? ""));
    }
  };

  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: project?.color }} />
            {project?.name} — Payments
          </DialogTitle>
          <DialogDescription>Every payment request raised for this project. Overall spend = approved requests.</DialogDescription>
        </DialogHeader>

        {/* Overall spend */}
        <div className="rounded-xl border border-border bg-accent-light/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Overall spend</p>
          <p className="mt-1 font-heading text-3xl font-bold text-ink-primary">{formatINR(totals.spend)}</p>
          <p className="text-xs text-ink-muted">{totals.count} approved payment{totals.count === 1 ? "" : "s"}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-lg bg-card p-2.5 border border-border">
              <p className="text-[11px] text-ink-muted">Paid</p>
              <p className="font-semibold text-success">{formatINR(totals.paid)}</p>
            </div>
            <div className="rounded-lg bg-card p-2.5 border border-border">
              <p className="text-[11px] text-ink-muted">Approved, to pay</p>
              <p className="font-semibold text-ink-primary">{formatINR(totals.toPay)}</p>
            </div>
            <div className="rounded-lg bg-card p-2.5 border border-border">
              <p className="text-[11px] text-ink-muted">Waiting approval</p>
              <p className="font-semibold text-warning">{formatINR(totals.pending)}</p>
            </div>
          </div>
        </div>

        {/* Logs */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <p className="mr-auto font-heading text-sm font-bold text-ink-primary">Payment logs</p>
          {([["spend", "Approved"], ["pending", "In progress"], ["rejected", "Rejected"], ["all", "All"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === k ? "border-primary bg-accent-light text-primary" : "border-border text-ink-secondary hover:bg-muted"}`}>
              {l}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></div>
        ) : !shown.length ? (
          <div className="flex flex-col items-center py-10 text-center text-sm text-ink-muted">
            <IndianRupee className="mb-2 h-8 w-8" />
            {rows.length ? "Nothing in this list." : "No payment requests for this project yet."}
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {shown.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, cls: "bg-muted text-ink-muted" };
              return (
                <div key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-primary">{r.purpose}</p>
                    <p className="text-xs text-ink-muted">
                      {format(new Date(r.created_at), "d MMM yyyy")} · Requested by {names[r.requester_id] ?? "—"}
                      {r.verifier_id && r.status !== "pending_verification" ? ` · Verified by ${names[r.verifier_id] ?? "—"}` : ""}
                      {r.reviewed_by && r.status === "approved" ? ` · Approved by ${names[r.reviewed_by] ?? "—"}` : ""}
                      {r.paid_at ? ` · Paid ${format(new Date(r.paid_at), "d MMM")}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                        {r.status === "approved" ? (r.paid_at ? "Paid" : "Approved · not paid") : st.label}
                      </span>
                      <button type="button" onClick={() => openFile(r.bill_path)}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-secondary hover:bg-muted">
                        <FileText className="h-3 w-3" /> Bill
                      </button>
                      {r.receipt_path && (
                        <button type="button" onClick={() => openFile(r.receipt_path!)}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-secondary hover:bg-muted">
                          <Receipt className="h-3 w-3" /> Receipt
                        </button>
                      )}
                    </div>
                  </div>
                  <p className={`shrink-0 font-heading text-base font-bold ${r.status === "rejected" ? "text-ink-muted line-through" : "text-ink-primary"}`}>
                    {formatINR(r.amount)}
                  </p>
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium text-ink-secondary">Total ({shown.length})</span>
              <span className="font-heading font-bold text-ink-primary">{formatINR(sum(shown))}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
