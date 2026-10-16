// Admins: project expenses.
//  Top: overall spend across all projects.
//  Then every project with its own spend — open one to see its breakdown and payment logs.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Receipt, Loader2, IndianRupee, ChevronDown, ChevronRight, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openFileLink } from "@/lib/nativeFiles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

const BUCKET = "payment-bills";
const ACCOUNT_LABEL: Record<string, string> = { cash: "Cash", expense: "Expense account", chennai: "Chennai account", bangalore: "Bangalore account" };
export const formatINR = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Row = {
  id: string; project_id: string | null; purpose: string; amount: number; status: string; created_at: string;
  requester_id: string; verifier_id: string | null; reviewed_by: string | null;
  paid_at: string | null; paid_by: string | null; bill_path: string; receipt_path: string | null; paid_from?: string | null;
  extra_bills?: { path: string; name: string }[] | null;
};
type Proj = { id: string; name: string; color: string };

/** Approved requests count as spend (paid or still to be paid). */
export const isSpend = (status: string) => status === "approved";
/** Old payments imported from the bank statement: no requester, no bill file. */
export const isImported = (r: { bill_path?: string | null }) => (r.bill_path ?? "").startsWith("imported/");
const isPending = (status: string) => status === "pending" || status === "pending_verification";
const sum = (list: Row[]) => list.reduce((s, r) => s + Number(r.amount || 0), 0);
const totalsOf = (list: Row[]) => {
  const spend = list.filter((r) => isSpend(r.status));
  return {
    spend: sum(spend),
    paid: sum(spend.filter((r) => r.paid_at)),
    toPay: sum(spend.filter((r) => !r.paid_at)),
    pending: sum(list.filter((r) => isPending(r.status))),
    count: spend.length,
  };
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_verification: { label: "Waiting for verification", cls: "bg-warning-light text-warning" },
  pending: { label: "Waiting for approval", cls: "bg-warning-light text-warning" },
  approved: { label: "Approved", cls: "bg-success-light text-success" },
  rejected: { label: "Rejected", cls: "bg-destructive-light text-destructive" },
};

async function openFile(path: string) {
  try {
    await openFileLink(async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    });
  } catch (e: any) {
    toast.error("Could not open the file: " + (e?.message ?? ""));
  }
}

function SummaryTiles({ t, big }: { t: ReturnType<typeof totalsOf>; big?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      {[
        ["Paid", t.paid, "text-success"],
        ["Approved, to pay", t.toPay, "text-ink-primary"],
        ["Waiting approval", t.pending, "text-warning"],
      ].map(([label, val, cls]) => (
        <div key={label as string} className={`rounded-lg border border-border bg-card ${big ? "p-3" : "p-2.5"}`}>
          <p className="text-[11px] text-ink-muted">{label}</p>
          <p className={`font-semibold ${cls}`}>{formatINR(val as number)}</p>
        </div>
      ))}
    </div>
  );
}

function PaymentLogs({ rows, names }: { rows: Row[]; names: Record<string, string> }) {
  const [filter, setFilter] = useState<"spend" | "pending" | "rejected" | "all">("all");
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "spend" ? isSpend(r.status) : filter === "pending" ? isPending(r.status) : r.status === "rejected");
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <p className="mr-auto text-xs font-semibold uppercase tracking-wide text-ink-muted">Payment logs</p>
        {([["all", "All"], ["spend", "Approved"], ["pending", "In progress"], ["rejected", "Rejected"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${filter === k ? "border-primary bg-accent-light text-primary" : "border-border text-ink-secondary hover:bg-muted"}`}>
            {l}
          </button>
        ))}
      </div>
      {!shown.length ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-ink-muted">
          {rows.length ? "Nothing in this list." : "No payment requests for this project yet."}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {shown.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, cls: "bg-muted text-ink-muted" };
            return (
              <div key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-primary">{r.purpose}</p>
                  <p className="text-xs text-ink-muted">
                    {format(new Date(r.created_at), "d MMM yyyy")}{isImported(r) ? " · From bank statement" : ` · Requested by ${names[r.requester_id] ?? "—"}`}
                    {r.verifier_id && r.status !== "pending_verification" ? ` · Verified by ${names[r.verifier_id] ?? "—"}` : ""}
                    {r.reviewed_by && r.status === "approved" ? ` · Approved by ${names[r.reviewed_by] ?? "—"}` : ""}
                    {r.paid_at ? ` · Paid ${format(new Date(r.paid_at), "d MMM")}` : ""}
                    {r.paid_from ? ` · ${ACCOUNT_LABEL[r.paid_from] ?? r.paid_from}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                      {r.status === "approved" ? (r.paid_at ? "Paid" : "Approved · not paid") : st.label}
                    </span>
                    {!isImported(r) && [r.bill_path, ...(r.extra_bills ?? []).map((b) => b.path)].map((path, i, all) => (
                      <button key={path} type="button" onClick={() => openFile(path)}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-secondary hover:bg-muted">
                        <FileText className="h-3 w-3" /> {all.length > 1 ? `Bill ${i + 1}` : "Bill"}
                      </button>
                    ))}
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
    </div>
  );
}

export default function ProjectExpensesDialog({ open, onClose, projects }: {
  open: boolean; onClose: () => void; projects: Proj[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [find, setFind] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["project-expenses"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payment_requests")
        .select("id, project_id, purpose, amount, status, created_at, requester_id, verifier_id, reviewed_by, paid_at, paid_by, bill_path, receipt_path, paid_from, extra_bills")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: names = {} } = useQuery({
    queryKey: ["profile-names"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name");
      return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.full_name])) as Record<string, string>;
    },
  });

  const projectRows = rows.filter((r) => r.project_id);
  const overall = useMemo(() => totalsOf(projectRows), [rows]);
  const list = useMemo(() => {
    const byProject = new Map<string, Row[]>();
    for (const r of projectRows) byProject.set(r.project_id!, [...(byProject.get(r.project_id!) ?? []), r]);
    return projects
      .map((p) => ({ p, rows: byProject.get(p.id) ?? [], t: totalsOf(byProject.get(p.id) ?? []) }))
      .filter((x) => !find.trim() || x.p.name.toLowerCase().includes(find.trim().toLowerCase()))
      .sort((a, b) => b.t.spend - a.t.spend || b.rows.length - a.rows.length || a.p.name.localeCompare(b.p.name));
  }, [rows, projects, find]);
  const noProject = rows.filter((r) => !r.project_id);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><IndianRupee className="h-5 w-5" /> Project expenses</DialogTitle>
          <DialogDescription>Spend = approved payment requests. Open a project to see its payment logs.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></div>
        ) : (
          <div className="space-y-4">
            {/* Overall spend — all projects */}
            <div className="rounded-xl border border-border bg-accent-light/40 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Overall spend · all projects</p>
              <p className="mt-1 font-heading text-3xl font-bold text-ink-primary">{formatINR(overall.spend)}</p>
              <p className="mb-3 text-xs text-ink-muted">
                {overall.count} approved payment{overall.count === 1 ? "" : "s"} across {list.filter((x) => x.t.spend > 0).length} project{list.filter((x) => x.t.spend > 0).length === 1 ? "" : "s"}
              </p>
              <SummaryTiles t={overall} big />
            </div>

            {/* Projects */}
            <div className="flex items-center gap-2">
              <p className="mr-auto font-heading text-sm font-bold text-ink-primary">Projects ({list.length})</p>
              <div className="relative w-48 sm:w-60">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search project"
                  className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none" />
              </div>
            </div>

            <div className="space-y-2">
              {list.map(({ p, rows: pr, t }) => {
                const isOpen = openId === p.id;
                return (
                  <div key={p.id} className="overflow-hidden rounded-xl border border-border bg-card">
                    <button type="button" onClick={() => setOpenId(isOpen ? null : p.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-heading text-sm font-bold text-ink-primary">{p.name}</p>
                        <p className="text-xs text-ink-muted">
                          {pr.length} request{pr.length === 1 ? "" : "s"}
                          {t.pending > 0 ? ` · ${formatINR(t.pending)} waiting approval` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-heading text-base font-bold ${t.spend > 0 ? "text-ink-primary" : "text-ink-muted"}`}>{formatINR(t.spend)}</p>
                        <p className="text-[11px] text-ink-muted">spent</p>
                      </div>
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" />}
                    </button>
                    {isOpen && (
                      <div className="space-y-3 border-t border-border bg-muted/20 p-4">
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Project expense</p>
                          <div className="mb-2 flex items-baseline gap-2">
                            <span className="font-heading text-2xl font-bold text-ink-primary">{formatINR(t.spend)}</span>
                            <span className="text-xs text-ink-muted">{t.count} approved payment{t.count === 1 ? "" : "s"}</span>
                          </div>
                          <SummaryTiles t={t} />
                        </div>
                        <PaymentLogs rows={pr} names={names} />
                      </div>
                    )}
                  </div>
                );
              })}
              {!list.length && <p className="py-8 text-center text-sm text-ink-muted">No projects found.</p>}
            </div>

            {noProject.length > 0 && (
              <p className="text-xs text-ink-muted">
                {noProject.length} payment request{noProject.length === 1 ? " was" : "s were"} raised without a project
                ({formatINR(sum(noProject.filter((r) => isSpend(r.status))))} approved) — not included above.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
