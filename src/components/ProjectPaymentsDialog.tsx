// Admins: project expenses.
//  Top: overall spend across all projects.
//  Then every project with its own spend — open one to see its breakdown and payment logs.
import { SUB_PROJECTS, subProjectLabel } from "@/lib/subProjects";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Receipt, Loader2, IndianRupee, ChevronDown, ChevronRight, Search, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openFileLink, saveFile } from "@/lib/nativeFiles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

const BUCKET = "payment-bills";
const ACCOUNT_LABEL: Record<string, string> = { cash: "Cash", expense: "Expense account", chennai: "Chennai account", bangalore: "Bangalore account" };
/** Non-admins who can see project expense tracking (view only). Keep in sync with is_expense_viewer() in the database. */
export const EXPENSE_VIEWER_EMAILS = ["hari@triloautomation.com"];
export const formatINR = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Row = {
  id: string; project_id: string | null; sub_project?: string | null; purpose: string; amount: number; status: string; created_at: string;
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

/** Excel: Summary (per project), Payment logs (every request) and By account. */
async function exportExpensesExcel(projects: Proj[], rows: Row[], names: Record<string, string>, fileLabel: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const money = "\"₹\"#,##0.00";
  const head = (ws: any, cols: string[]) => {
    const r = ws.addRow(cols);
    r.font = { bold: true };
    r.eachCell((c: any) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6E6" } }; c.border = { bottom: { style: "thin" } }; });
    return r;
  };
  const projOf = new Map(projects.map((p) => [p.id, p.name]));
  const mine = rows.filter((r) => r.project_id && projOf.has(r.project_id));
  const all = totalsOf(mine);

  // 1. Summary
  const ws = wb.addWorksheet("Summary");
  ws.addRow([`Project expenses — ${fileLabel}`]).font = { bold: true, size: 14 };
  ws.addRow([`Exported ${new Date().toLocaleString("en-IN")} · Spend = approved payment requests`]);
  ws.addRow([]);
  ws.addRow(["Overall spend", all.spend]).font = { bold: true };
  ws.addRow(["Paid", all.paid]);
  ws.addRow(["Approved, to pay", all.toPay]);
  ws.addRow(["Waiting approval", all.pending]);
  ws.addRow(["Approved payments", all.count]);
  for (let i = 4; i <= 7; i++) ws.getCell(`B${i}`).numFmt = money;
  ws.addRow([]);
  head(ws, ["Project", "Requests", "Approved payments", "Spend", "Paid", "Approved, to pay", "Waiting approval", "Rejected"]);
  const per = projects.map((p) => {
    const pr = mine.filter((r) => r.project_id === p.id);
    return { p, pr, t: totalsOf(pr), rejected: pr.filter((r) => r.status === "rejected").length };
  }).sort((a, b) => b.t.spend - a.t.spend || a.p.name.localeCompare(b.p.name));
  const first = ws.rowCount + 1;
  per.forEach(({ p, pr, t, rejected }) => ws.addRow([p.name, pr.length, t.count, t.spend, t.paid, t.toPay, t.pending, rejected]));
  const last = ws.rowCount;
  const tot = ws.addRow(["TOTAL", mine.length, all.count, all.spend, all.paid, all.toPay, all.pending, mine.filter((r) => r.status === "rejected").length]);
  tot.font = { bold: true };
  for (let r = first; r <= ws.rowCount; r++) ["D", "E", "F", "G"].forEach((c) => { ws.getCell(`${c}${r}`).numFmt = money; });
  [42, 11, 18, 16, 16, 18, 18, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  if (last >= first) ws.autoFilter = { from: { row: first - 1, column: 1 }, to: { row: last, column: 8 } };

  // 2. Payment logs
  const wl = wb.addWorksheet("Payment logs");
  head(wl, ["Date", "Project", "Subproject", "Purpose", "Amount", "Status", "Requested by", "Verified by", "Approved by", "Paid on", "Paid by", "Paid from", "Bills"]);
  [...mine].sort((a, b) => (projOf.get(a.project_id!) ?? "").localeCompare(projOf.get(b.project_id!) ?? "") || b.created_at.localeCompare(a.created_at))
    .forEach((r) => {
      const imp = isImported(r);
      const row = wl.addRow([
        new Date(r.created_at), projOf.get(r.project_id!) ?? "", subProjectLabel(r.sub_project), r.purpose, Number(r.amount || 0), STATUS[r.status]?.label ?? r.status,
        imp ? "From bank statement" : names[r.requester_id] ?? "", r.verifier_id ? names[r.verifier_id] ?? "" : "",
        r.reviewed_by ? names[r.reviewed_by] ?? "" : "", r.paid_at ? new Date(r.paid_at) : "", r.paid_by ? names[r.paid_by] ?? "" : "",
        r.paid_from ? ACCOUNT_LABEL[r.paid_from] ?? r.paid_from : "", imp ? 0 : 1 + (r.extra_bills?.length ?? 0),
      ]);
      row.getCell(1).numFmt = "dd-mmm-yyyy"; row.getCell(5).numFmt = money; row.getCell(10).numFmt = "dd-mmm-yyyy";
    });
  [13, 34, 18, 44, 14, 22, 20, 18, 18, 13, 18, 18, 7].forEach((w, i) => { wl.getColumn(i + 1).width = w; });
  wl.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, wl.rowCount), column: 13 } };
  wl.views = [{ state: "frozen", ySplit: 1 }];

  // 3. By subproject (approved spend), per project
  const ws2 = wb.addWorksheet("By subproject");
  const cols = [...SUB_PROJECTS.map((x) => x.label), "Not specified"];
  head(ws2, ["Project", ...cols, "Total"]);
  const spendRows = mine.filter((r) => isSpend(r.status));
  const keyOf = (r: Row) => subProjectLabel(r.sub_project) || "Not specified";
  const firstS = ws2.rowCount + 1;
  per.forEach(({ p }) => {
    const pr = spendRows.filter((r) => r.project_id === p.id);
    if (!pr.length) return;
    ws2.addRow([p.name, ...cols.map((c) => sum(pr.filter((r) => keyOf(r) === c)) || ""), sum(pr)]);
  });
  const st = ws2.addRow(["TOTAL", ...cols.map((c) => sum(spendRows.filter((r) => keyOf(r) === c))), sum(spendRows)]);
  st.font = { bold: true };
  for (let r = firstS; r <= ws2.rowCount; r++) for (let c = 2; c <= cols.length + 2; c++) ws2.getRow(r).getCell(c).numFmt = money;
  ws2.getColumn(1).width = 40; for (let c = 2; c <= cols.length + 2; c++) ws2.getColumn(c).width = 18;

  // 4. By account (approved spend)
  const wa = wb.addWorksheet("By account");
  head(wa, ["Paid from", "Payments", "Amount"]);
  const spend = mine.filter((r) => isSpend(r.status));
  const accounts = new Map<string, Row[]>();
  spend.forEach((r) => { const k = r.paid_at ? (r.paid_from ? ACCOUNT_LABEL[r.paid_from] ?? r.paid_from : "Not set") : "Not paid yet"; accounts.set(k, [...(accounts.get(k) ?? []), r]); });
  [...accounts.entries()].sort((a, b) => sum(b[1]) - sum(a[1])).forEach(([k, list]) => { wa.addRow([k, list.length, sum(list)]).getCell(3).numFmt = money; });
  const at = wa.addRow(["TOTAL", spend.length, sum(spend)]); at.font = { bold: true }; at.getCell(3).numFmt = money;
  [22, 11, 18].forEach((w, i) => { wa.getColumn(i + 1).width = w; });

  const buf = await wb.xlsx.writeBuffer();
  await saveFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Project expenses - ${fileLabel.replace(/[\\/:*?"<>|]/g, "-")} - ${format(new Date(), "dd-MMM-yyyy")}.xlsx`);
}

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

/** Expenses tracked by subproject (Electrical, Mechanical …) across every payment request. */
function SubProjectsView({ rows, projects, names }: { rows: Row[]; projects: Proj[]; names: Record<string, string> }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const projName = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? "—" : "No project");
  const groups = [...SUB_PROJECTS.map((s) => ({ key: s.key as string, label: s.label })), { key: "", label: "Not specified" }]
    .map((g) => {
      const gr = rows.filter((r) => (r.sub_project ?? "") === g.key);
      return { ...g, rows: gr, t: totalsOf(gr) };
    });
  const tracked = groups.filter((g) => g.key).reduce((s, g) => s + g.t.spend, 0);
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">All payment requests, with or without a project. Tracked under a subproject: <span className="font-semibold text-ink-primary">{formatINR(tracked)}</span> approved.</p>
      {groups.filter((g) => g.key || g.rows.length).map((g) => {
        const isOpen = openKey === g.label;
        const byProject = new Map<string, number>();
        g.rows.filter((r) => isSpend(r.status)).forEach((r) => byProject.set(projName(r.project_id), (byProject.get(projName(r.project_id)) ?? 0) + Number(r.amount || 0)));
        return (
          <div key={g.label} className="overflow-hidden rounded-xl border border-border bg-card">
            <button type="button" onClick={() => setOpenKey(isOpen ? null : g.label)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30">
              <div className="min-w-0 flex-1">
                <p className={`truncate font-heading text-sm font-bold ${g.key ? "text-ink-primary" : "text-ink-muted"}`}>{g.label}</p>
                <p className="text-xs text-ink-muted">
                  {g.rows.length} request{g.rows.length === 1 ? "" : "s"} · {byProject.size} project{byProject.size === 1 ? "" : "s"}
                  {g.t.pending > 0 ? ` · ${formatINR(g.t.pending)} waiting approval` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-heading text-base font-bold ${g.t.spend > 0 ? "text-ink-primary" : "text-ink-muted"}`}>{formatINR(g.t.spend)}</p>
                <p className="text-[11px] text-ink-muted">spent</p>
              </div>
              {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" />}
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-border bg-muted/20 p-4">
                <SummaryTiles t={g.t} />
                {byProject.size > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {[...byProject.entries()].sort((a, b) => b[1] - a[1]).map(([name, total]) => (
                      <span key={name} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-ink-secondary">
                        {name}: <span className="font-semibold text-ink-primary">{formatINR(total)}</span>
                      </span>
                    ))}
                  </div>
                )}
                <PaymentLogs rows={g.rows} names={names} projectName={projName} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Approved spend of one project split by subproject. */
function SubProjectSplit({ rows }: { rows: Row[] }) {
  const spend = rows.filter((r) => isSpend(r.status));
  const parts = [...SUB_PROJECTS.map((s) => ({ key: s.key as string, label: s.label })), { key: "", label: "Not specified" }]
    .map((s) => ({ ...s, total: sum(spend.filter((r) => (r.sub_project ?? "") === s.key)) }))
    .filter((s) => s.total > 0);
  if (!parts.length || (parts.length === 1 && parts[0].key === "")) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {parts.map((s) => (
        <span key={s.label} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-ink-secondary">
          {s.label}: <span className="font-semibold text-ink-primary">{formatINR(s.total)}</span>
        </span>
      ))}
    </div>
  );
}

function PaymentLogs({ rows, names, projectName }: { rows: Row[]; names: Record<string, string>; projectName?: (id: string | null) => string }) {
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
                  <p className="text-sm font-semibold text-ink-primary">{r.purpose}{r.sub_project && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary align-middle">{subProjectLabel(r.sub_project)}</span>}</p>
                  <p className="text-xs text-ink-muted">
                    {format(new Date(r.created_at), "d MMM yyyy")}{projectName ? ` · ${projectName(r.project_id)}` : ""}{isImported(r) ? " · From bank statement" : ` · Requested by ${names[r.requester_id] ?? "—"}`}
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
  const [view, setView] = useState<"projects" | "subprojects">("projects");
  const [find, setFind] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["project-expenses"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payment_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: names = {} } = useQuery({
    queryKey: ["profile-names"],
    enabled: open,
    queryFn: async () => {
      // everyone's name, also for people who can't read the profiles table directly
      const [{ data: active }, { data: direct }] = await Promise.all([
        supabase.rpc("get_active_profiles"),
        supabase.from("profiles").select("id, full_name"),
      ]);
      return Object.fromEntries([...(active ?? []), ...(direct ?? [])].map((p: any) => [p.id, p.full_name])) as Record<string, string>;
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
  const [exporting, setExporting] = useState(false);
  const doExport = async (subset: Proj[], label: string) => {
    setExporting(true);
    try { await exportExpensesExcel(subset, rows, names, label); }
    catch (e: any) { toast.error("Could not export: " + (e?.message ?? "")); }
    finally { setExporting(false); }
  };

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

            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {([["projects", "Projects"], ["subprojects", "Subprojects"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setView(k)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === k ? "bg-primary text-primary-foreground" : "text-ink-secondary hover:text-ink-primary"}`}>{l}</button>
              ))}
            </div>

            {view === "subprojects" && <SubProjectsView rows={rows} projects={projects} names={names} />}

            {view === "projects" && (<>
            {/* Projects */}
            <div className="flex items-center gap-2">
              <p className="mr-auto font-heading text-sm font-bold text-ink-primary">Projects ({list.length})</p>
              <button type="button" disabled={exporting || !rows.length} onClick={() => doExport(list.map((x) => x.p), find.trim() ? `filtered "${find.trim()}"` : "All projects")}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export Excel
              </button>
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
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Project expense</p>
                            <button type="button" disabled={exporting} onClick={() => doExport([p], p.name)}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
                              <Download className="h-3.5 w-3.5" /> Export this project
                            </button>
                          </div>
                          <div className="mb-2 flex items-baseline gap-2">
                            <span className="font-heading text-2xl font-bold text-ink-primary">{formatINR(t.spend)}</span>
                            <span className="text-xs text-ink-muted">{t.count} approved payment{t.count === 1 ? "" : "s"}</span>
                          </div>
                          <SummaryTiles t={t} />
                          <SubProjectSplit rows={pr} />
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
            </>)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
