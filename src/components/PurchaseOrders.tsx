// ─────────────────────────────────────────────────────────────────────────────
//  Sales Orders and Purchase Orders, per project (several of each).
//   • Sales Order (SO)    — the customer's order for the project. Not linked to
//                           payments; shown against the project's total spend.
//   • Purchase Order (PO) — our order on a supplier. Payments are linked to it;
//                           value vs paid, balance and a graph over time.
//  (Both live in the purchase_orders table: kind = 'customer' → SO, 'vendor' → PO.)
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Plus, Loader2, Upload, X, Pencil, ExternalLink, ClipboardList } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { openFileLink } from "@/lib/nativeFiles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const sb = supabase as any;
const BUCKET = "po-documents";

export type OrderKind = "customer" | "vendor";
export type PO = {
  id: string; project_id: string; kind: OrderKind; po_number: string; party: string | null;
  po_date: string | null; value: number | null; taxable_value?: number | null; notes: string | null; doc_path: string | null; doc_name: string | null;
  status: "open" | "closed"; created_at: string;
};
/** The payment fields these views need. */
export type POPayment = {
  id: string; po_id?: string | null; project_id: string | null; amount: number; status: string; purpose: string;
  created_at: string; paid_at: string | null; requester_id: string; bill_path?: string | null;
};

export const KIND_LABEL: Record<OrderKind, string> = { customer: "Sales Order", vendor: "Purchase Order" };
export const KIND_SHORT: Record<OrderKind, string> = { customer: "SO", vendor: "PO" };
const PARTY: Record<OrderKind, string> = { customer: "Customer", vendor: "Vendor" };
const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const isPending = (s: string) => s === "pending" || s === "pending_verification";
const sumOf = (l: POPayment[]) => l.reduce((s, r) => s + Number(r.amount || 0), 0);

/** Every SO / PO the user may see (admins, Hari, Anu). Empty list for others or before the SQL is run. */
export function usePurchaseOrders(enabled = true) {
  return useQuery({
    queryKey: ["purchase-orders"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from("purchase_orders").select("*").order("po_date", { ascending: false, nullsFirst: false });
      if (error) return [] as PO[];
      return (data ?? []) as PO[];
    },
  });
}

/** PO: payments linked to it. SO: the whole project's spend (SOs are not linked to payments). */
export function poTotals(po: PO, rows: POPayment[]) {
  const mine = po.kind === "vendor" ? rows.filter((r) => r.po_id === po.id) : rows.filter((r) => r.project_id === po.project_id);
  const approved = mine.filter((r) => r.status === "approved");
  const spent = sumOf(approved);
  const value = Number(po.value || 0);
  return {
    count: mine.length,
    spent,
    paid: sumOf(approved.filter((r) => r.paid_at)),
    toPay: sumOf(approved.filter((r) => !r.paid_at)),
    pending: sumOf(mine.filter((r) => isPending(r.status))),
    value,
    balance: value - spent,
    pct: value > 0 ? Math.round((spent / value) * 100) : 0,
  };
}

export async function openPODoc(po: Pick<PO, "doc_path">) {
  if (!po.doc_path) return;
  try {
    await openFileLink(async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(po.doc_path!, 300);
      if (error) throw error;
      return data.signedUrl;
    });
  } catch (e: any) {
    toast.error("Could not open the document: " + (e?.message ?? ""));
  }
}

// ── form ─────────────────────────────────────────────────────────────────────
export type PODraft = { kind: OrderKind; po_number: string; party: string; po_date: string; value: string; taxable: string; notes: string; file: File | null };
export const emptyPODraft = (kind: OrderKind = "customer"): PODraft =>
  ({ kind, po_number: "", party: "", po_date: format(new Date(), "yyyy-MM-dd"), value: "", taxable: "", notes: "", file: null });

export function PODraftFields({ value, onChange, existingDoc }: { value: PODraft; onChange: (d: PODraft) => void; existingDoc?: string | null }) {
  const set = (patch: Partial<PODraft>) => onChange({ ...value, ...patch });
  const s = KIND_SHORT[value.kind];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">{s} number *</label>
          <Input value={value.po_number} onChange={(e) => set({ po_number: e.target.value })} placeholder={value.kind === "customer" ? "e.g. 4500123456" : "e.g. TRL/PO/118"} className="h-10" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">{PARTY[value.kind]}</label>
          <Input value={value.party} onChange={(e) => set({ party: e.target.value })} placeholder={value.kind === "customer" ? "e.g. Caterpillar" : "e.g. Anand Steels"} className="h-10" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">{s} date</label>
          <Input type="date" value={value.po_date} onChange={(e) => set({ po_date: e.target.value })} className="h-10" />
        </div>
        {value.kind === "customer" ? (<>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Taxable value (₹, without GST)</label>
            <Input type="number" inputMode="decimal" min="0" value={value.taxable} onChange={(e) => set({ taxable: e.target.value })} placeholder="0" className="h-10" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Invoice value (₹, with GST)</label>
            <Input type="number" inputMode="decimal" min="0" value={value.value} onChange={(e) => set({ value: e.target.value })} placeholder="0" className="h-10" />
            {value.value !== "" && value.taxable !== "" && (
              <p className={`mt-1 text-[11px] ${Number(value.value) < Number(value.taxable) ? "text-destructive" : "text-ink-muted"}`}>
                {Number(value.value) < Number(value.taxable)
                  ? "Invoice value can't be less than the taxable value"
                  : `GST ${inr(Number(value.value) - Number(value.taxable))}`}
              </p>
            )}
          </div>
        </>) : (
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">{s} value (₹)</label>
            <Input type="number" inputMode="decimal" min="0" value={value.value} onChange={(e) => set({ value: e.target.value })} placeholder="0" className="h-10" />
          </div>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">Notes</label>
        <Textarea value={value.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="Scope, terms, payment milestones…" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-muted">{s} document{value.kind === "customer" ? " *" : ""}</label>
        {value.file ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate">{value.file.name}</span>
            <button type="button" onClick={() => set({ file: null })} className="text-ink-muted hover:text-destructive" aria-label="Remove file"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-3 text-sm hover:bg-muted/40">
            <Upload className="h-4 w-4 text-ink-muted" />
            <span className="text-ink-secondary">{existingDoc ? `Replace “${existingDoc}”` : `Upload the ${s} (PDF, photo or file)`}</span>
            <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) set({ file: f }); e.target.value = ""; }} />
          </label>
        )}
      </div>
    </div>
  );
}

/** Insert or update an SO / PO (uploads the document first). */
export async function savePO(projectId: string, d: PODraft, existing?: PO | null) {
  const s = KIND_SHORT[d.kind];
  if (!d.po_number.trim()) throw new Error(`Enter the ${s} number`);
  if (d.kind === "customer" && !d.file && !existing?.doc_path) throw new Error("Upload the SO document");
  if (d.kind === "customer" && d.value !== "" && d.taxable !== "" && Number(d.value) < Number(d.taxable))
    throw new Error("Invoice value can't be less than the taxable value");
  let doc_path = existing?.doc_path ?? null;
  let doc_name = existing?.doc_name ?? null;
  if (d.file) {
    if (d.file.size > 25 * 1024 * 1024) throw new Error(`The ${s} document is larger than 25 MB`);
    const path = `${projectId}/${crypto.randomUUID()}-${d.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, d.file, { contentType: d.file.type || undefined });
    if (upErr) throw new Error(/bucket/i.test(upErr.message) ? "Order storage isn't set up yet — run TRILO_purchase_orders.sql" : upErr.message);
    if (existing?.doc_path) supabase.storage.from(BUCKET).remove([existing.doc_path]).catch(() => {});
    doc_path = path; doc_name = d.file.name;
  }
  const row = {
    project_id: projectId, kind: d.kind, po_number: d.po_number.trim(), party: d.party.trim() || null,
    po_date: d.po_date || null, value: d.value === "" ? null : Number(d.value), ...(d.kind === "customer" ? { taxable_value: d.taxable === "" ? null : Number(d.taxable) } : {}), notes: d.notes.trim() || null, doc_path, doc_name,
  };
  const q = existing ? sb.from("purchase_orders").update(row).eq("id", existing.id) : sb.from("purchase_orders").insert(row);
  const { error } = await q;
  if (error) {
    if (/taxable_value/.test(error.message)) throw new Error("Run TRILO_so_taxable_value.sql first");
    if (/purchase_orders/.test(error.message) && /exist|schema/.test(error.message)) throw new Error("Orders aren't set up yet — run TRILO_purchase_orders.sql");
    if (/duplicate|unique/i.test(error.message)) throw new Error(`This project already has that ${s} number`);
    throw error;
  }
}

export function POEditDialog({ projectId, projectName, po, kind = "customer", open, onClose }: {
  projectId: string; projectName?: string; po?: PO | null; kind?: OrderKind; open: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PODraft>(() => emptyPODraft(kind));
  const [saving, setSaving] = useState(false);
  const [lastKey, setLastKey] = useState("");
  const key = `${open}-${po?.id ?? "new"}-${kind}`;
  if (key !== lastKey) {
    setLastKey(key);
    setDraft(po ? { kind: po.kind, po_number: po.po_number, party: po.party ?? "", po_date: po.po_date ?? "", value: po.value == null ? "" : String(po.value), taxable: po.taxable_value == null ? "" : String(po.taxable_value), notes: po.notes ?? "", file: null } : emptyPODraft(kind));
  }
  const label = KIND_LABEL[po?.kind ?? kind];
  const save = async () => {
    setSaving(true);
    try {
      await savePO(projectId, draft, po);
      toast.success(po ? `${label} updated` : `${label} added`);
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["po-options"] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{po ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}</DialogTitle>
          {projectName && <DialogDescription>{projectName}</DialogDescription>}
        </DialogHeader>
        <PODraftFields value={draft} onChange={setDraft} existingDoc={po?.doc_name} />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {po ? "Save" : `Add ${KIND_SHORT[po?.kind ?? kind]}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── list + detail ────────────────────────────────────────────────────────────
function Bar({ pct }: { pct: number }) {
  const over = pct > 100;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${over ? "bg-destructive" : pct >= 85 ? "bg-warning" : "bg-primary"}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

/** Cards of SOs or POs; tap one to open its detail. */
export function POList({ pos, rows, projectName, onOpen, onAdd, addLabel, empty, compact }: {
  pos: PO[]; rows: POPayment[]; projectName?: (id: string) => string; onOpen: (po: PO) => void;
  onAdd?: () => void; addLabel?: string; empty?: string;
  compact?: boolean;   // just number, party and value (no totals)
}) {
  return (
    <div className="space-y-2">
      {pos.map((po) => {
        const t = poTotals(po, rows);
        const s = KIND_SHORT[po.kind];
        return (
          <button key={po.id} type="button" onClick={() => onOpen(po)}
            className="w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-heading text-sm font-bold text-ink-primary">{s} {po.po_number}</span>
              {po.status === "closed" && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-ink-muted">Closed</span>}
              {po.doc_path && <FileText className="h-3.5 w-3.5 text-ink-muted" />}
              <span className="ml-auto text-xs text-ink-muted">
                {compact || po.kind === "customer" ? (po.value != null ? inr(Number(po.value)) : "") : `${t.count} payment${t.count === 1 ? "" : "s"}`}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {[po.party, projectName?.(po.project_id), po.po_date ? format(new Date(po.po_date), "d MMM yyyy") : null].filter(Boolean).join(" · ")}
            </p>
            {!compact && po.kind === "vendor" && (<>
              <div className="mt-2"><Bar pct={t.pct} /></div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs">
                <span className="text-ink-secondary">Paid against it <b className="text-ink-primary">{inr(t.spent)}</b>{t.value ? ` of ${inr(t.value)} (${t.pct}%)` : ""}</span>
                {t.value > 0 && <span className={t.balance < 0 ? "font-semibold text-destructive" : "text-ink-secondary"}>{t.balance < 0 ? "Over by " : "Balance "}<b>{inr(Math.abs(t.balance))}</b></span>}
              </div>
            </>)}
            {!compact && po.kind === "customer" && t.value > 0 && (
              <p className="mt-1.5 text-xs text-ink-secondary">Project spend so far <b className="text-ink-primary">{inr(t.spent)}</b> · {t.pct}% of the SO value</p>
            )}
          </button>
        );
      })}
      {!pos.length && <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-ink-muted">{empty ?? "Nothing here yet."}</p>}
      {onAdd && (
        <button type="button" onClick={onAdd} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <Plus className="h-4 w-4" /> {addLabel ?? "Add"}
        </button>
      )}
    </div>
  );
}

export function PODetailDialog({ po, rows, names, projectName, onClose, onEdit }: {
  po: PO | null; rows: POPayment[]; names: Record<string, string>; projectName?: string; onClose: () => void; onEdit?: () => void;
}) {
  const t = po ? poTotals(po, rows) : null;
  const isPO = po?.kind === "vendor";
  const s = po ? KIND_SHORT[po.kind] : "";
  const list = useMemo(() => (po && isPO ? rows.filter((r) => r.po_id === po.id).sort((a, b) => b.created_at.localeCompare(a.created_at)) : []), [po, isPO, rows]);
  // running total of approved payments against the PO, day by day
  const chart = useMemo(() => {
    const ok = list.filter((r) => r.status === "approved")
      .map((r) => ({ d: (r.paid_at ?? r.created_at).slice(0, 10), a: Number(r.amount || 0) }))
      .sort((a, b) => a.d.localeCompare(b.d));
    let run = 0;
    const pts: Array<{ d: string; label: string; total: number }> = [];
    for (const p of ok) {
      run += p.a;
      const last = pts[pts.length - 1];
      if (last && last.d === p.d) last.total = run;
      else pts.push({ d: p.d, label: format(new Date(p.d), "d MMM"), total: run });
    }
    if (pts.length === 1) pts.unshift({ d: "", label: "", total: 0 });
    return pts;
  }, [list]);

  const tiles: Array<[string, string, string]> = !po || !t ? [] : isPO ? [
    ["PO value", t.value ? inr(t.value) : "—", "text-ink-primary"],
    ["Paid against PO", inr(t.spent), "text-success"],
    [t.balance < 0 ? "Over by" : "Balance", t.value ? inr(Math.abs(t.balance)) : "—", t.balance < 0 ? "text-destructive" : "text-ink-primary"],
    ["Waiting approval", inr(t.pending), "text-warning"],
  ] : [
    ["Invoice value (with GST)", t.value ? inr(t.value) : "—", "text-ink-primary"],
    ["Taxable value (without GST)", po.taxable_value != null ? inr(Number(po.taxable_value)) : "—", "text-ink-primary"],
    ["GST", po.taxable_value != null && t.value ? inr(t.value - Number(po.taxable_value)) : "—", "text-ink-primary"],
    ["SO date", po.po_date ? format(new Date(po.po_date), "d MMM yyyy") : "—", "text-ink-primary"],
  ];

  return (
    <Dialog open={!!po} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        {po && t && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <ClipboardList className="h-5 w-5" /> {s} {po.po_number}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isPO ? "bg-warning-light text-warning" : "bg-accent-light text-primary"}`}>{KIND_LABEL[po.kind]}</span>
              </DialogTitle>
              <DialogDescription>
                {[po.party, projectName, po.po_date ? format(new Date(po.po_date), "d MMM yyyy") : null].filter(Boolean).join(" · ")}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tiles.map(([l, v, c]) => (
                <div key={l} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-[11px] text-ink-muted">{l}</p>
                  <p className={`font-heading text-base font-bold ${c}`}>{v}</p>
                </div>
              ))}
            </div>
            {t.value > 0 && (
              <div>
                <Bar pct={t.pct} />
                <p className="mt-1 text-right text-xs text-ink-muted">
                  {isPO ? `${t.pct}% of the PO used${t.toPay ? ` · ${inr(t.toPay)} approved, not yet paid` : ""}`
                        : `Project spend is ${t.pct}% of the SO value (all approved payments of the project)`}
                </p>
              </div>
            )}

            {isPO && (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Paid against this PO over time</p>
                {chart.length ? (
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="poFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickLine={false} />
                        <YAxis width={56} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickLine={false}
                          tickFormatter={(v) => (v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v))}
                          domain={[0, (max: number) => Math.max(max, t.value || 0) * 1.08]} />
                        <Tooltip formatter={(v: number) => [inr(v), "Paid so far"]} labelFormatter={(l) => l || "Start"} />
                        {t.value > 0 && <ReferenceLine y={t.value} stroke="hsl(var(--destructive))" strokeDasharray="6 4" label={{ value: `PO ${inr(t.value)}`, position: "insideTopRight", fontSize: 11 }} />}
                        <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#poFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-ink-muted">No approved payments against this PO yet.</p>
                )}
              </div>
            )}

            {po.notes && <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm text-ink-secondary">{po.notes}</p>}

            <div className="flex flex-wrap gap-2">
              {po.doc_path && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openPODoc(po)}>
                  <FileText className="h-4 w-4" /> {po.doc_name ?? `${s} document`} <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              {onEdit && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}><Pencil className="h-4 w-4" /> Edit {s}</Button>
              )}
            </div>

            {isPO && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Payments against this PO ({list.length})</p>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {list.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <div className="min-w-0 flex-1 max-sm:basis-full">
                        <p className="text-sm font-medium text-ink-primary break-words">{r.purpose}</p>
                        <p className="text-xs text-ink-muted">
                          {format(new Date(r.created_at), "d MMM yyyy")}
                          {(r.bill_path ?? "").startsWith("imported/") ? " · From bank statement" : ` · ${names[r.requester_id] ?? "—"}`}
                          {r.paid_at ? ` · Paid ${format(new Date(r.paid_at), "d MMM")}` : ""}
                        </p>
                      </div>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === "approved" ? "bg-success-light text-success" : r.status === "rejected" ? "bg-destructive-light text-destructive" : "bg-warning-light text-warning"}`}>
                        {r.status === "approved" ? (r.paid_at ? "Paid" : "Approved") : r.status === "rejected" ? "Rejected" : "Waiting"}
                      </span>
                      <span className={`font-heading text-sm font-bold ${r.status === "rejected" ? "text-ink-muted line-through" : "text-ink-primary"}`}>{inr(r.amount)}</span>
                    </div>
                  ))}
                  {!list.length && <p className="px-3 py-4 text-center text-sm text-ink-muted">No payments linked yet. Link a payment from Payments or from the project's payment logs.</p>}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
