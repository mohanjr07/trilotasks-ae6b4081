// ─────────────────────────────────────────────────────────────────────────────
//  Leads — the enquiry database (PD / PC) and the monthly projections.
//  Only admins and the sales team (aiswarya.v@, harishkanna@) see this.
//  "Converted" on a lead asks Anu (by notification) to create the project.
//  (TRILO_leads.sql)
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle2, FileText, FolderKanban, Handshake, History, Loader2, MoreVertical, Pencil, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { openFileLink } from "@/lib/nativeFiles";
import { FilePickButtons, PickedFile } from "@/components/FilePick";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { canSeeLeads, inr, type Lead } from "@/lib/leadsAccess";
import { toast } from "sonner";

const sb = supabase as any;
type Tab = "PD" | "PC" | "PROJ";
type Projection = { id: string; month_label: string; month_start: string; customer: string; pg: string | null; po_value: number | null; po_receipt: boolean; remarks: string | null; sort: number | null };
type Revision = { id: string; lead_id: string; rev_no: number; rev_date: string; quoted_value: number | null; final_quoted_value: number | null; products: string | null; notes: string | null; file_path: string | null; file_name: string | null; created_at: string };
type Summary = { id: string; section: string; label: string; value: number | null; sort: number | null };

const STATUSES = ["IN PROGRESS", "ON HOLD", "WORK IN PROGRESS", "COMPLETED", "LOST"];
const statusTone = (s: string | null) => {
  const v = (s ?? "").toUpperCase();
  if (v.includes("COMPLETED")) return "bg-success/15 text-success border-success/30";
  if (v.includes("LOST")) return "bg-destructive/10 text-destructive border-destructive/30";
  if (v.includes("HOLD")) return "bg-warning/15 text-warning border-warning/30";
  if (v) return "bg-primary/10 text-primary border-primary/25";
  return "bg-muted text-ink-muted border-border";
};
const errText = (e: any) => {
  const m = e?.message ?? String(e ?? "");
  if (/does not exist|schema cache/i.test(m)) return "Leads isn't set up yet — run TRILO_leads.sql.";
  return m;
};
const fmtDate = (d: string | null) => d ? format(new Date(d + "T00:00:00"), "d MMM yyyy") : "—";

function useLeadsData(enabled: boolean) {
  return useQuery({
    queryKey: ["leads"],
    enabled,
    queryFn: async () => {
      const [l, p, s, pr, rv] = await Promise.all([
        sb.from("leads").select("*").order("sort", { ascending: true, nullsFirst: false }).order("created_at"),
        sb.from("lead_projections").select("*").order("month_start").order("sort", { ascending: true, nullsFirst: false }),
        sb.from("lead_summary").select("*").order("sort", { ascending: true, nullsFirst: false }),
        sb.from("projects").select("*"),
        sb.from("lead_revisions").select("lead_id, rev_no"),       // TRILO_lead_revisions.sql
      ]);
      const latestRev: Record<string, number> = {};
      for (const x of (rv.data ?? []) as Array<{ lead_id: string; rev_no: number }>) latestRev[x.lead_id] = Math.max(latestRev[x.lead_id] ?? -1, x.rev_no);
      if (l.error) return { error: errText(l.error), leads: [] as Lead[], projections: [] as Projection[], summary: [] as Summary[], projects: [] as any[], latestRev, revisionsReady: false };
      return { error: null as string | null, leads: (l.data ?? []) as Lead[], projections: (p.data ?? []) as Projection[], summary: (s.data ?? []) as Summary[],
        projects: ((pr.data ?? []) as any[]).filter((x) => x.lead_id), latestRev, revisionsReady: !rv.error };
    },
  });
}

export default function LeadsPage() {
  const { profile } = useAuth();
  const allowed = canSeeLeads(profile as any);
  const { data, isLoading } = useLeadsData(allowed);
  const [tab, setTab] = useState<Tab>("PD");
  if (profile && !allowed) return <Navigate to="/" replace />;

  const leads = data?.leads ?? [];
  return (
    <AnimatedPage>
      <div className="mb-5">
        <h1 className="flex items-center gap-2 font-heading text-2xl sm:text-[28px] font-bold text-ink-primary"><Handshake className="h-6 w-6" /> Leads</h1>
        <p className="text-sm text-ink-muted">Enquiry database and monthly projections. Mark a lead <b>Converted</b> to ask Anu to create its project.</p>
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm">
        {([["PD", `PD enquiries (${leads.filter((l) => l.sheet === "PD").length})`], ["PC", `PC enquiries (${leads.filter((l) => l.sheet === "PC").length})`], ["PROJ", "Projections"]] as [Tab, string][]).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${tab === k ? "bg-card text-ink-primary shadow-sm" : "text-ink-muted hover:text-ink-primary"}`}>{t}</button>
        ))}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></div>
      ) : data?.error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{data.error}</p>
      ) : tab === "PROJ" ? (
        <Projections rows={data?.projections ?? []} summary={data?.summary ?? []} />
      ) : (
        <Enquiries sheet={tab} leads={leads.filter((l) => l.sheet === tab)} summary={(data?.summary ?? []).filter((s) => s.section === tab)} projects={data?.projects ?? []} latestRev={data?.latestRev ?? {}} />
      )}
    </AnimatedPage>
  );
}

// ── PD / PC enquiries ───────────────────────────────────────────────────────
function Enquiries({ sheet, leads, summary, projects, latestRev }: { sheet: "PD" | "PC"; leads: Lead[]; summary: Summary[]; projects: any[]; latestRev: Record<string, number> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [edit, setEdit] = useState<Lead | "new" | null>(null);
  const [convert, setConvert] = useState<Lead | null>(null);
  const [revs, setRevs] = useState<Lead | null>(null);
  const RevChip = ({ l }: { l: Lead }) => (
    <button type="button" onClick={() => setRevs(l)} title="Quotation revisions"
      className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0 align-middle text-[10px] font-semibold text-ink-secondary hover:bg-muted">
      <History className="h-2.5 w-2.5" /> {latestRev[l.id] != null ? `Rev ${latestRev[l.id]}` : "Rev"}
    </button>
  );
  const isPD = sheet === "PD";

  const statuses = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) { const s = (l.status ?? "").trim() || "NO STATUS"; m.set(s, (m.get(s) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [leads]);
  const shown = leads.filter((l) => {
    if (status === "CONVERTED" ? !l.converted : status !== "ALL" && ((l.status ?? "").trim() || "NO STATUS") !== status) return false;
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return [l.name, l.location, l.reference, l.products, l.sso, l.remarks, l.po_number].some((x) => (x ?? "").toLowerCase().includes(t));
  });
  const total = shown.reduce((s, l) => s + Number(l.final_quoted_value ?? l.quoted_value ?? 0), 0);
  const projectOf = (l: Lead) => projects.find((p) => p.lead_id === l.id);

  const del = async (l: Lead) => {
    if (!confirm(`Delete the lead "${l.name}"?`)) return;
    const { error } = await sb.from("leads").delete().eq("id", l.id);
    if (error) return toast.error(errText(error));
    qc.invalidateQueries({ queryKey: ["leads"] });
  };
  const undo = async (l: Lead) => {
    const { error } = await sb.rpc("convert_lead", { p_lead: l.id, p_value: false });
    if (error) return toast.error(errText(error));
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const ConvertCell = ({ l }: { l: Lead }) => {
    const p = projectOf(l);
    if (!l.converted) return (
      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 border-success/40 text-success hover:bg-success/10" onClick={() => setConvert(l)}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Converted
      </Button>
    );
    return p ? (
      <button type="button" onClick={() => navigate("/projects")} className="inline-flex max-w-full items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
        <FolderKanban className="h-3 w-3 shrink-0" /> <span className="truncate">{p.name}</span>
      </button>
    ) : (
      <span className="inline-block rounded-lg bg-warning/15 px-2 py-0.5 text-center text-[11px] font-medium leading-tight text-warning">Converted · project pending</span>
    );
  };
  const RowMenu = ({ l }: { l: Lead }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button className="rounded p-1 text-ink-muted hover:text-ink-primary" aria-label="More"><MoreVertical className="h-4 w-4" /></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setRevs(l)}><History className="mr-2 h-3.5 w-3.5" /> Revisions</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setEdit(l)}><Pencil className="mr-2 h-3.5 w-3.5" /> Edit</DropdownMenuItem>
        {l.converted && !projectOf(l) && <DropdownMenuItem onClick={() => undo(l)}><Undo2 className="mr-2 h-3.5 w-3.5" /> Undo converted</DropdownMenuItem>}
        <DropdownMenuItem className="text-destructive" onClick={() => del(l)}><Trash2 className="mr-2 h-3.5 w-3.5" /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-4">
      {/* status chips */}
      <div className="flex flex-wrap gap-1.5">
        {[["ALL", leads.length] as [string, number], ...statuses, ["CONVERTED", leads.filter((l) => l.converted).length] as [string, number]].map(([s, n]) => (
          <button key={s} type="button" onClick={() => setStatus(s)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-ink-secondary hover:bg-muted"}`}>
            {s === "ALL" ? "All" : s === "CONVERTED" ? "Converted" : s.charAt(0) + s.slice(1).toLowerCase()} · {n}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, product, reference, PO…" className="h-10 pl-9" />
        </div>
        <Button onClick={() => setEdit("new")} className="h-10 gap-1.5"><Plus className="h-4 w-4" /> Add lead</Button>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border border-border bg-card px-2.5 py-1.5"><span className="text-ink-muted">Showing</span> <b>{shown.length}</b></span>
        <span className="rounded-md border border-border bg-card px-2.5 py-1.5"><span className="text-ink-muted">Quoted value</span> <b>{inr(total)}</b></span>
      </div>

      {/* phones: cards */}
      <div className="space-y-2 md:hidden">
        {shown.map((l) => (
          <div key={l.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-primary">{l.name}{l.location ? <span className="font-normal text-ink-muted"> · {l.location}</span> : null}<RevChip l={l} /></p>
                <p className="whitespace-pre-line text-sm text-ink-secondary">{l.products ?? "—"}</p>
              </div>
              <RowMenu l={l} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              {l.status && <span className={`rounded-full border px-2 py-0.5 font-medium ${statusTone(l.status)}`}>{l.status}</span>}
              {l.sso && <span className="rounded-full bg-muted px-2 py-0.5">SSO: {l.sso}</span>}
              {l.remarks && <span className="rounded-full bg-muted px-2 py-0.5">{l.remarks}</span>}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-ink-muted">Quoted</dt><dd className="text-right font-medium">{inr(l.quoted_value)}</dd>
              {isPD && <><dt className="text-ink-muted">Final quoted</dt><dd className="text-right font-medium">{inr(l.final_quoted_value)}</dd></>}
              {l.expected_order_date && <><dt className="text-ink-muted">Expected order</dt><dd className="text-right">{fmtDate(l.expected_order_date)}</dd></>}
              {l.po_number && <><dt className="text-ink-muted">PO</dt><dd className="truncate text-right">{l.po_number}{l.po_value != null ? ` · ${inr(l.po_value)}` : ""}</dd></>}
              {l.reference && <><dt className="text-ink-muted">Ref</dt><dd className="truncate text-right">{l.reference}</dd></>}
            </dl>
            <div className="mt-2"><ConvertCell l={l} /></div>
          </div>
        ))}
      </div>

      {/* desktop: table — fits the page width, no sideways scrolling */}
      <div className="hidden rounded-xl border border-border bg-card md:block">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-10" />
            <col className="w-[22%]" />
            <col className="w-[18%]" />
            <col className="w-[15%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead className="bg-muted/50 text-left text-xs text-ink-muted">
            <tr>
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Customer</th>
              <th className="px-2 py-2">Products</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-right">Value</th>
              <th className="px-2 py-2">Expected · PO</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((l) => (
              <tr key={l.id} className="align-top hover:bg-muted/30">
                <td className="px-2 py-2 text-ink-muted">{l.sl_no ?? ""}</td>
                <td className="px-2 py-2">
                  <p className="break-words font-medium text-ink-primary">{l.name}<RevChip l={l} /></p>
                  <p className="break-words text-xs text-ink-muted">{[isPD && l.sso ? `SSO: ${l.sso}` : null, l.location].filter(Boolean).join(" · ")}</p>
                  {l.reference && <p className="break-all text-[11px] text-ink-muted">{l.reference}</p>}
                </td>
                <td className="whitespace-pre-line break-words px-2 py-2">{l.products ?? ""}</td>
                <td className="px-2 py-2">
                  {l.status && <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(l.status)}`}>{l.status}</span>}
                  {l.remarks && <p className="mt-1 break-words text-xs text-ink-muted">{l.remarks}</p>}
                </td>
                <td className="px-2 py-2 text-right">
                  {isPD && l.final_quoted_value != null ? (
                    <>
                      <p className="font-medium text-ink-primary">{inr(l.final_quoted_value)}</p>
                      <p className="text-[11px] text-ink-muted">Quoted {inr(l.quoted_value)}</p>
                    </>
                  ) : <p className="font-medium text-ink-primary">{inr(l.quoted_value)}</p>}
                  {isPD && l.coverage_pct != null && <p className="text-[11px] text-ink-muted">{l.coverage_pct}% cov</p>}
                </td>
                <td className="px-2 py-2 text-xs">
                  {l.expected_order_date && <p className="text-ink-primary">{fmtDate(l.expected_order_date)}</p>}
                  {l.po_number && <p className="break-all text-ink-secondary">{l.po_number}</p>}
                  {l.po_value != null && <p className="text-ink-muted">{inr(l.po_value)}</p>}
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-start justify-end gap-1">
                    <ConvertCell l={l} />
                    <RowMenu l={l} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="py-8 text-center text-sm text-ink-muted">No leads here.</p>}

      <SummaryLines section={sheet} rows={summary} autoTotal />

      {edit && <LeadDialog sheet={sheet} lead={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {convert && <ConvertDialog lead={convert} onClose={() => setConvert(null)} />}
      {revs && <RevisionsDialog lead={revs} onClose={() => setRevs(null)} />}
    </div>
  );
}

function ConvertDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const { error } = await sb.rpc("convert_lead", { p_lead: lead.id, p_value: true });
    setBusy(false);
    if (error) return toast.error(errText(error));
    toast.success("Marked converted — Anu has been asked to create the project");
    qc.invalidateQueries({ queryKey: ["leads"] });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-success" /> Lead converted?</DialogTitle>
          <DialogDescription>
            <b>{lead.name}</b>{lead.products ? ` — ${lead.products.replace(/\n/g, ", ")}` : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-ink-secondary">This marks the lead as converted and sends Anu a notification to <b>create the project</b> for it. The project will open with these lead details.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={go} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Yes, request project</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LeadDialog({ sheet, lead, onClose }: { sheet: "PD" | "PC"; lead: Lead | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const k of ["sl_no", "sso", "name", "location", "reference", "products", "status", "remarks", "quoted_value", "final_quoted_value", "coverage_pct", "expected_order_date", "po_number", "po_value"])
      o[k] = lead && (lead as any)[k] != null ? String((lead as any)[k]) : "";
    return o;
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const num = (s: string) => { const v = s.replace(/,/g, "").trim(); return v === "" || isNaN(Number(v)) ? null : Number(v); };
  const t = (s: string) => s.trim() || null;

  const save = async () => {
    if (!f.name.trim()) return toast.error("Customer name is required");
    setSaving(true);
    const row: any = {
      sheet, sl_no: num(f.sl_no), sso: t(f.sso), name: f.name.trim(), location: t(f.location), reference: t(f.reference), products: t(f.products),
      status: t(f.status)?.toUpperCase() ?? null, remarks: t(f.remarks), quoted_value: num(f.quoted_value), final_quoted_value: num(f.final_quoted_value),
      coverage_pct: num(f.coverage_pct), expected_order_date: t(f.expected_order_date), po_number: t(f.po_number), po_value: num(f.po_value),
      updated_at: new Date().toISOString(),
    };
    if (!lead) row.sort = 100000 + Math.floor(Date.now() / 1000) % 100000;
    const { data: saved, error } = lead ? await sb.from("leads").update(row).eq("id", lead.id).select("id") : await sb.from("leads").insert(row).select("id");
    setSaving(false);
    if (error) return toast.error(errText(error));
    if (!lead && saved?.[0]?.id && (row.quoted_value != null || row.final_quoted_value != null)) {
      // the first quotation = Rev 0
      await sb.from("lead_revisions").insert({ lead_id: saved[0].id, rev_no: 0, quoted_value: row.quoted_value, final_quoted_value: row.final_quoted_value, products: row.products, notes: "First quotation" });
    }
    toast.success(lead ? "Lead updated" : "Lead added");
    qc.invalidateQueries({ queryKey: ["leads"] });
    onClose();
  };

  const F = ({ k, label, type = "text", ph }: { k: string; label: string; type?: string; ph?: string }) => (
    <label className="block text-xs font-medium text-ink-secondary">{label}
      <Input type={type} value={f[k]} onChange={set(k)} placeholder={ph} className="mt-1 h-9" inputMode={/value|pct|sl_no/.test(k) ? "decimal" : undefined} />
    </label>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lead ? "Edit lead" : `New ${sheet} lead`}</DialogTitle>
          <DialogDescription>Enquiry details as in the sheet.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">{F({ k: "name", label: "Customer *", ph: "e.g. Yusen" })}</div>
          {F({ k: "location", label: "Location", ph: "e.g. BLR" })}
          {F({ k: "sso", label: "SSO", ph: "e.g. Jai" })}
          <div className="col-span-2">{F({ k: "reference", label: "Reference number", ph: "TAPL/JS/…" })}</div>
          <label className="col-span-2 block text-xs font-medium text-ink-secondary">Products
            <Textarea value={f.products} onChange={set("products")} rows={2} className="mt-1" />
          </label>
          <label className="block text-xs font-medium text-ink-secondary">Status
            <Input list="lead-statuses" value={f.status} onChange={set("status")} className="mt-1 h-9" placeholder="IN PROGRESS" />
            <datalist id="lead-statuses">{STATUSES.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          {F({ k: "remarks", label: "Remarks", ph: "Waiting for PO" })}
          {F({ k: "quoted_value", label: "Quoted value (₹)" })}
          {F({ k: "final_quoted_value", label: "Final quoted value (₹)" })}
          {F({ k: "coverage_pct", label: "% of coverage" })}
          {F({ k: "expected_order_date", label: "Expected order date", type: "date" })}
          {F({ k: "po_number", label: "PO number" })}
          {F({ k: "po_value", label: "PO value (₹)" })}
          {F({ k: "sl_no", label: "Sl no" })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── summary lines (Order bank, SUM, FWRD …) ─────────────────────────────────
const isTotalLabel = (l: string) => /^\s*(grand\s+)?total\s*$/i.test(l);

function SummaryLines({ section, rows: allRows, autoTotal = false }: { section: string; rows: Summary[]; autoTotal?: boolean }) {
  const qc = useQueryClient();
  // with autoTotal the "Total" line is worked out from the other lines (never typed)
  const rows = autoTotal ? allRows.filter((r) => !isTotalLabel(r.label)) : allRows;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const valOf = (r: Summary) => {
    const d = drafts[r.id];
    if (d === undefined) return Number(r.value ?? 0);
    const n = Number(d.replace(/,/g, "").trim());
    return isNaN(n) ? 0 : n;
  };
  const total = rows.reduce((t, r) => t + valOf(r), 0);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["leads"] });
  const add = async () => {
    if (!label.trim()) return;
    if (autoTotal && isTotalLabel(label)) return toast.error("Total is added up automatically");
    const v = value.replace(/,/g, "").trim();
    const { error } = await sb.from("lead_summary").insert({ section, label: label.trim(), value: v === "" ? null : Number(v), sort: rows.length + 1 });
    if (error) return toast.error(errText(error));
    setLabel(""); setValue(""); setAdding(false); refresh();
  };
  const update = async (r: Summary, v: string) => {
    const n = v.replace(/,/g, "").trim();
    const { error } = await sb.from("lead_summary").update({ value: n === "" ? null : Number(n) }).eq("id", r.id);
    if (error) toast.error(errText(error)); else refresh();
  };
  const del = async (r: Summary) => {
    if (!confirm(`Remove "${r.label}"?`)) return;
    await sb.from("lead_summary").delete().eq("id", r.id); refresh();
  };
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-primary">Summary</p>
        {!adding && <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Plus className="h-3.5 w-3.5" /> Add line</button>}
      </div>
      {rows.length === 0 && !adding && <p className="text-xs text-ink-muted">No summary lines.</p>}
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-ink-secondary">{r.label}</span>
            <Input defaultValue={r.value ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
              onBlur={(e) => { if (e.target.value !== String(r.value ?? "")) update(r, e.target.value); }}
              className="h-8 w-36 text-right" inputMode="decimal" />
            <span className="hidden w-32 text-right text-xs text-ink-muted sm:inline">{inr(valOf(r))}</span>
            <button type="button" onClick={() => del(r)} className="p-1 text-ink-muted hover:text-destructive" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      {autoTotal && rows.length > 0 && (
        <div className="mt-1 flex items-center gap-2 border-t-2 border-border pt-2 text-sm">
          <span className="min-w-0 flex-1 font-semibold text-ink-primary">Total <span className="text-xs font-normal text-ink-muted">(auto)</span></span>
          <span className="w-36 pr-3 text-right font-semibold text-ink-primary">{inr(total)}</span>
          <span className="hidden w-32 sm:inline" />
          <span className="w-[22px]" />
        </div>
      )}
      {adding && (
        <div className="mt-2 flex gap-2">
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Order Bank)" className="h-8" />
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" className="h-8 w-32" inputMode="decimal" />
          <Button size="sm" className="h-8" onClick={add}>Add</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

// ── monthly projections ─────────────────────────────────────────────────────
function Projections({ rows, summary }: { rows: Projection[]; summary: Summary[] }) {
  const qc = useQueryClient();
  const months = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (!m.has(r.month_label)) m.set(r.month_label, r.month_start);
    for (const s of summary) if (s.section !== "PD" && s.section !== "PC" && !m.has(s.section)) m.set(s.section, "9999-12-31");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([label, start]) => ({ label, start }));
  }, [rows, summary]);
  const [sel, setSel] = useState<string | null>(null);
  const [extraMonth, setExtraMonth] = useState<{ label: string; start: string } | null>(null);
  const allMonths = extraMonth && !months.some((m) => m.label === extraMonth.label) ? [...months, extraMonth] : months;
  const current = allMonths.find((m) => m.label === sel) ?? allMonths[allMonths.length - 1];
  const [edit, setEdit] = useState<Projection | "new" | null>(null);
  const [newMonth, setNewMonth] = useState(false);
  const list = rows.filter((r) => r.month_label === current?.label);
  const total = list.reduce((s, r) => s + Number(r.po_value ?? 0), 0);
  const received = list.filter((r) => r.po_receipt).reduce((s, r) => s + Number(r.po_value ?? 0), 0);

  const del = async (r: Projection) => {
    if (!confirm(`Remove "${r.customer}" from ${r.month_label}?`)) return;
    const { error } = await sb.from("lead_projections").delete().eq("id", r.id);
    if (error) return toast.error(errText(error));
    qc.invalidateQueries({ queryKey: ["leads"] });
  };
  const toggle = async (r: Projection) => {
    const { error } = await sb.from("lead_projections").update({ po_receipt: !r.po_receipt }).eq("id", r.id);
    if (error) return toast.error(errText(error));
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {allMonths.map((m) => (
          <button key={m.label} type="button" onClick={() => setSel(m.label)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${current?.label === m.label ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-ink-secondary hover:bg-muted"}`}>{m.label}</button>
        ))}
        <button type="button" onClick={() => setNewMonth(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-ink-secondary hover:bg-muted"><Plus className="h-3 w-3" /> Month</button>
      </div>

      {current ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[["Total PO value", total], ["PO received", received], ["Forward", total - received]].map(([t, v]) => (
              <div key={t as string} className="rounded-xl border border-border bg-card p-3">
                <p className="text-[11px] text-ink-muted">{t}</p>
                <p className="font-heading text-base font-bold text-ink-primary sm:text-lg">{inr(v as number)}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end"><Button onClick={() => setEdit("new")} className="h-9 gap-1.5"><Plus className="h-4 w-4" /> Add to {current.label}</Button></div>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {list.length === 0 && <p className="p-4 text-center text-sm text-ink-muted">Nothing in this month yet.</p>}
            {list.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-medium text-ink-primary">{r.customer}</p>
                  <p className="text-xs text-ink-muted">{[r.pg, r.remarks].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="w-32 text-right text-sm font-medium">{inr(r.po_value)}</span>
                <button type="button" onClick={() => toggle(r)} title="PO receipt — tap to change"
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${r.po_receipt ? "bg-success/15 text-success" : "bg-muted text-ink-muted"}`}>PO {r.po_receipt ? "received" : "not received"}</button>
                <button type="button" onClick={() => setEdit(r)} className="p-1 text-ink-muted hover:text-ink-primary" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => del(r)} className="p-1 text-ink-muted hover:text-destructive" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          <SummaryLines section={current.label} rows={summary.filter((s) => s.section === current.label)} />
        </>
      ) : (
        <p className="py-8 text-center text-sm text-ink-muted">No projections yet — add a month.</p>
      )}

      {edit && current && <ProjectionDialog month={current} row={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {newMonth && <NewMonthDialog onClose={() => setNewMonth(false)} onAdd={(m) => { setExtraMonth(m); setSel(m.label); setNewMonth(false); }} />}
    </div>
  );
}

function NewMonthDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (m: { label: string; start: string }) => void }) {
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const go = () => {
    if (!month) return;
    const d = new Date(month + "-01T00:00:00");
    const fy = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;           // Apr–Mar financial year
    const label = `${format(d, "MMM")} ${String(fy).slice(2)}-${String(fy + 1).slice(2)}`;
    onAdd({ label, start: month + "-01" });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New projection month</DialogTitle><DialogDescription>Then add the customers for that month.</DialogDescription></DialogHeader>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10" />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go}>Add month</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectionDialog({ month, row, onClose }: { month: { label: string; start: string }; row: Projection | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [customer, setCustomer] = useState(row?.customer ?? "");
  const [pg, setPg] = useState(row?.pg ?? "");
  const [value, setValue] = useState(row?.po_value != null ? String(row.po_value) : "");
  const [receipt, setReceipt] = useState(row?.po_receipt ?? false);
  const [remarks, setRemarks] = useState(row?.remarks ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!customer.trim()) return toast.error("Customer is required");
    setSaving(true);
    const v = value.replace(/,/g, "").trim();
    const data: any = { customer: customer.trim(), pg: pg.trim() || null, po_value: v === "" ? null : Number(v), po_receipt: receipt, remarks: remarks.trim() || null };
    const { error } = row ? await sb.from("lead_projections").update(data).eq("id", row.id)
      : await sb.from("lead_projections").insert({ ...data, month_label: month.label, month_start: month.start, sort: Math.floor(Date.now() / 1000) % 1000000 });
    setSaving(false);
    if (error) return toast.error(errText(error));
    qc.invalidateQueries({ queryKey: ["leads"] });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{row ? "Edit" : "Add"} — {month.label}</DialogTitle><DialogDescription>Projection line.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-ink-secondary">Customer *<Input value={customer} onChange={(e) => setCustomer(e.target.value)} className="mt-1 h-9" placeholder="e.g. Curefit, BLR" /></label>
          <label className="block text-xs font-medium text-ink-secondary">PG (product)<Input value={pg} onChange={(e) => setPg(e.target.value)} className="mt-1 h-9" placeholder="e.g. Gravity Spiral" /></label>
          <label className="block text-xs font-medium text-ink-secondary">PO value (₹)<Input value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 h-9" inputMode="decimal" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={receipt} onChange={(e) => setReceipt(e.target.checked)} /> PO received</label>
          <label className="block text-xs font-medium text-ink-secondary">Remarks<Input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="mt-1 h-9" placeholder="Awaiting PO" /></label>
        </div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>Save</Button></div>
      </DialogContent>
    </Dialog>
  );
}

// ── quotation revisions of one lead ─────────────────────────────────────────
function RevisionsDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: revs = [], isLoading, error } = useQuery({
    queryKey: ["lead-revisions", lead.id],
    queryFn: async () => {
      const { data, error } = await sb.from("lead_revisions").select("*").eq("lead_id", lead.id).order("rev_no", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Revision[];
    },
  });
  const latest = revs[0];
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quoted, setQuoted] = useState("");
  const [finalV, setFinalV] = useState("");
  const [products, setProducts] = useState(lead.products ?? "");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["lead-revisions", lead.id] }); qc.invalidateQueries({ queryKey: ["leads"] }); };
  const num = (x: string) => { const v = x.replace(/,/g, "").trim(); return v === "" || isNaN(Number(v)) ? null : Number(v); };

  const startAdd = () => {
    setQuoted(latest?.quoted_value != null ? String(latest.quoted_value) : lead.quoted_value != null ? String(lead.quoted_value) : "");
    setFinalV(latest?.final_quoted_value != null ? String(latest.final_quoted_value) : "");
    setProducts(latest?.products ?? lead.products ?? "");
    setNotes(""); setFile(null); setAdding(true);
  };
  const save = async () => {
    if (!notes.trim() && num(quoted) == null && !file) return toast.error("Enter what changed, the new value, or attach the quotation");
    setSaving(true);
    try {
      let file_path: string | null = null;
      if (file) {
        file_path = `${lead.id}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("lead-files").upload(file_path, file, { contentType: file.type || undefined });
        if (upErr) throw upErr;
      }
      const { error } = await sb.from("lead_revisions").insert({
        lead_id: lead.id, rev_date: date, quoted_value: num(quoted), final_quoted_value: num(finalV),
        products: products.trim() || null, notes: notes.trim() || null, file_path, file_name: file?.name ?? null,
      });
      if (error) { if (file_path) await supabase.storage.from("lead-files").remove([file_path]); throw error; }
      toast.success("Revision added");
      setAdding(false); refresh();
    } catch (e: any) { toast.error(errText(e)); }
    setSaving(false);
  };
  const del = async (r: Revision) => {
    if (!confirm(`Delete Rev ${r.rev_no}?`)) return;
    const { error } = await sb.from("lead_revisions").delete().eq("id", r.id);
    if (error) return toast.error(errText(error));
    if (r.file_path) await supabase.storage.from("lead-files").remove([r.file_path]);
    refresh();
  };
  const open = async (path: string) => {
    try {
      await openFileLink(async () => {
        const { data, error } = await supabase.storage.from("lead-files").createSignedUrl(path, 300);
        if (error) throw error;
        return data.signedUrl;
      });
    } catch (e: any) { toast.error("Could not open the file: " + (e?.message ?? "")); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Revisions — {lead.name}</DialogTitle>
          <DialogDescription>Every quotation revision before conversion. The lead shows the latest one.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Revisions aren't set up yet — run TRILO_lead_revisions.sql.</p>
        ) : (
          <>
            {!adding ? (
              <Button onClick={startAdd} className="gap-1.5"><Plus className="h-4 w-4" /> New revision {latest ? `(Rev ${latest.rev_no + 1})` : "(Rev 0)"}</Button>
            ) : (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-sm font-semibold">Rev {latest ? latest.rev_no + 1 : 0}</p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-medium text-ink-secondary">Date<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9" /></label>
                  <span />
                  <label className="block text-xs font-medium text-ink-secondary">Quoted value (₹)<Input value={quoted} onChange={(e) => setQuoted(e.target.value)} inputMode="decimal" className="mt-1 h-9" /></label>
                  <label className="block text-xs font-medium text-ink-secondary">Final quoted (₹)<Input value={finalV} onChange={(e) => setFinalV(e.target.value)} inputMode="decimal" className="mt-1 h-9" /></label>
                </div>
                <label className="block text-xs font-medium text-ink-secondary">Products / scope<Textarea value={products} onChange={(e) => setProducts(e.target.value)} rows={2} className="mt-1" /></label>
                <label className="block text-xs font-medium text-ink-secondary">What changed<Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1" placeholder="e.g. Added 2 diverters, 5% discount" /></label>
                {file ? <PickedFile file={file} onRemove={() => setFile(null)} /> : (
                  <div><p className="mb-1 text-xs font-medium text-ink-secondary">Quotation (optional)</p><FilePickButtons onPick={setFile} /></div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
                  <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save revision</Button>
                </div>
              </div>
            )}
            {isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-muted" /> : revs.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-muted">No revisions yet.</p>
            ) : (
              <ol className="relative space-y-3 border-l border-border pl-4">
                {revs.map((r, i) => (
                  <li key={r.id} className="relative">
                    <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-primary" : "bg-border"}`} />
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink-primary">Rev {r.rev_no}
                          <span className="ml-2 font-normal text-ink-muted">{fmtDate(r.rev_date)}</span>
                          {i === 0 && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Latest</span>}
                        </p>
                        <p className="text-xs text-ink-secondary">Quoted {inr(r.quoted_value)}{r.final_quoted_value != null ? ` · Final ${inr(r.final_quoted_value)}` : ""}</p>
                        {r.products && <p className="whitespace-pre-line text-xs text-ink-muted">{r.products}</p>}
                        {r.notes && <p className="mt-0.5 text-sm text-ink-secondary">{r.notes}</p>}
                        {r.file_path && (
                          <button type="button" onClick={() => open(r.file_path!)} className="mt-1 inline-flex max-w-full items-center gap-1 text-xs font-medium text-primary">
                            <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{r.file_name ?? "Quotation"}</span>
                          </button>
                        )}
                      </div>
                      <button type="button" onClick={() => del(r)} className="p-1 text-ink-muted hover:text-destructive" aria-label="Delete revision"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
