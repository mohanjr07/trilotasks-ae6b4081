// ─────────────────────────────────────────────────────────────────────────────
//  Sales Orders tracker (not linked to payments or project spend).
//  For each SO: invoices raised (billing) and payments received from the customer.
//    Billed           = sum of invoices (with GST)
//    Balance billing  = SO invoice value − billed
//    Received         = sum of payments received
//    Balance          = SO invoice value − received
//    Outstanding      = billed − received (invoiced, not yet received)
//  Admins and project editors (Anu) record entries; admins, Hari and Anu see them.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Plus, Loader2, Upload, X, Pencil, ExternalLink, Trash2, Search, ReceiptText, HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openFileLink } from "@/lib/nativeFiles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePurchaseOrders, POEditDialog, openPODoc, type PO } from "@/components/PurchaseOrders";
import { FilePickButtons, PickedFile } from "@/components/FilePick";
import { toast } from "sonner";

const sb = supabase as any;
const BUCKET = "po-documents";
const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export type SOEntry = {
  id: string; so_id: string; kind: "invoice" | "receipt"; entry_date: string; ref_no: string | null;
  amount: number; taxable_amount: number | null; notes: string | null; doc_path: string | null; doc_name: string | null; created_at: string;
};

export function useSOEntries(enabled = true) {
  return useQuery({
    queryKey: ["so-entries"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from("so_entries").select("*").order("entry_date", { ascending: true });
      if (error) return { list: [] as SOEntry[], missing: /so_entries/.test(error.message ?? "") };
      return { list: (data ?? []) as SOEntry[], missing: false };
    },
  });
}

export function soTotals(so: PO, entries: SOEntry[]) {
  const mine = entries.filter((e) => e.so_id === so.id);
  const sum = (k: SOEntry["kind"]) => mine.filter((e) => e.kind === k).reduce((s, e) => s + Number(e.amount || 0), 0);
  const value = Number(so.value || 0);
  const billed = sum("invoice");
  const received = sum("receipt");
  return {
    value, billed, received,
    balanceBilling: value - billed,
    balance: value - received,
    outstanding: billed - received,
    billedPct: value > 0 ? Math.round((billed / value) * 100) : 0,
    receivedPct: value > 0 ? Math.round((received / value) * 100) : 0,
    invoices: mine.filter((e) => e.kind === "invoice").length,
    receipts: mine.filter((e) => e.kind === "receipt").length,
  };
}

function Bar({ pct, tone }: { pct: number; tone: "bill" | "recv" }) {
  const cls = pct > 100 ? "bg-destructive" : pct === 100 ? "bg-success" : tone === "bill" ? "bg-primary" : "bg-warning";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ── all Sales Orders ─────────────────────────────────────────────────────────
export default function SalesOrdersDialog({ open, onClose, projects, canEdit }: {
  open: boolean; onClose: () => void; projects: Array<{ id: string; name: string }>; canEdit: boolean;
}) {
  const { data: orders = [] } = usePurchaseOrders(open);
  const { data: ent } = useSOEntries(open);
  const entries = ent?.list ?? [];
  const [find, setFind] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [addFor, setAddFor] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const projName = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);

  const sos = orders.filter((o) => o.kind === "customer");
  const q = find.trim().toLowerCase();
  const shown = sos.filter((o) => !q || [o.po_number, o.party, projName[o.project_id]].some((x) => (x ?? "").toLowerCase().includes(q)));
  const tot = sos.reduce((a, o) => {
    const t = soTotals(o, entries);
    return { value: a.value + t.value, billed: a.billed + t.billed, received: a.received + t.received };
  }, { value: 0, billed: 0, received: 0 });
  const current = sos.find((o) => o.id === openId) ?? null;
  const qc = useQueryClient();
  const removeSO = async (so: PO) => {
    const t = soTotals(so, entries);
    const extra = t.invoices + t.receipts ? `\n\nIts ${t.invoices} invoice(s) and ${t.receipts} payment(s) received will be deleted too.` : "";
    if (!window.confirm(`Delete SO ${so.po_number}? This cannot be undone.${extra}`)) return;
    const files = [so.doc_path, ...entries.filter((e) => e.so_id === so.id).map((e) => e.doc_path)].filter(Boolean) as string[];
    const { data, error } = await sb.from("purchase_orders").delete().eq("id", so.id).select("id");
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error("You don't have permission to delete this SO"); return; }
    if (files.length) supabase.storage.from(BUCKET).remove(files).catch(() => {});
    toast.success(`SO ${so.po_number} deleted`);
    if (openId === so.id) setOpenId(null);
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["so-entries"] });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92dvh] overflow-y-auto overflow-x-hidden [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> Sales Orders</DialogTitle>
          <DialogDescription>Billing and payments received against each customer Sales Order.</DialogDescription>
        </DialogHeader>

        {ent?.missing && (
          <p className="rounded-lg border border-warning/40 bg-warning-light p-3 text-sm text-warning">Run TRILO_so_billing.sql in Supabase to start recording invoices and receipts.</p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {([
            [`SO value (${sos.length})`, tot.value, "text-ink-primary"],
            ["Billed", tot.billed, "text-primary"],
            ["Balance billing", tot.value - tot.billed, "text-ink-primary"],
            ["Received", tot.received, "text-success"],
            ["Balance", tot.value - tot.received, "text-warning"],
          ] as const).map(([l, v, c]) => (
            <div key={l} className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] text-ink-muted">{l}</p>
              <p className={`font-heading text-base font-bold ${c}`}>{inr(v)}</p>
            </div>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search SO no., customer or project"
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" />
        </div>

        {canEdit && (
          <div className="flex gap-2 rounded-lg border border-dashed border-border p-2">
            <select value={addFor} onChange={(e) => setAddFor(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">Add a Sales Order to project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button size="sm" className="h-9" disabled={!addFor} onClick={() => setAddOpen(true)}>Add SO</Button>
          </div>
        )}
        {addFor && <POEditDialog projectId={addFor} projectName={projName[addFor]} kind="customer" open={addOpen} onClose={() => setAddOpen(false)} />}

        <div className="space-y-2">
          {!shown.length && <p className="py-6 text-center text-sm text-ink-muted">{sos.length ? "No Sales Orders match." : "No Sales Orders yet."}</p>}
          {shown.map((so) => {
            const t = soTotals(so, entries);
            return (
              <div key={so.id} role="button" tabIndex={0} onClick={() => setOpenId(so.id)}
                onKeyDown={(e) => { if (e.key === "Enter") setOpenId(so.id); }}
                className="w-full cursor-pointer rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-heading text-sm font-bold text-ink-primary">SO {so.po_number}</span>
                  {so.doc_path && <FileText className="h-3.5 w-3.5 text-ink-muted" />}
                  <span className="ml-auto text-sm font-semibold text-ink-primary">{inr(t.value)}</span>
                  {canEdit && (
                    <button type="button" aria-label="Delete SO" title="Delete SO"
                      onClick={(e) => { e.stopPropagation(); removeSO(so); }}
                      className="rounded p-1 text-ink-muted hover:bg-destructive-light hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {[so.party, projName[so.project_id], so.po_date ? format(new Date(so.po_date), "d MMM yyyy") : null].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-ink-secondary"><span>Billed {inr(t.billed)} ({t.billedPct}%)</span><span>Bal. billing <b className="text-ink-primary">{inr(t.balanceBilling)}</b></span></div>
                    <Bar pct={t.billedPct} tone="bill" />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-ink-secondary"><span>Received {inr(t.received)} ({t.receivedPct}%)</span><span>Balance <b className="text-ink-primary">{inr(t.balance)}</b></span></div>
                    <Bar pct={t.receivedPct} tone="recv" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <SODetailDialog so={current} projectName={current ? projName[current.project_id] : ""} entries={entries} canEdit={canEdit} onClose={() => setOpenId(null)} onDelete={removeSO} />
      </DialogContent>
    </Dialog>
  );
}

// ── one Sales Order ──────────────────────────────────────────────────────────
type Draft = { kind: SOEntry["kind"]; entry_date: string; ref_no: string; amount: string; taxable: string; notes: string; file: File | null };
const emptyDraft = (kind: SOEntry["kind"]): Draft => ({ kind, entry_date: format(new Date(), "yyyy-MM-dd"), ref_no: "", amount: "", taxable: "", notes: "", file: null });

export function SODetailDialog({ so, projectName, entries, canEdit, onClose, onDelete }: {
  so: PO | null; projectName?: string; entries: SOEntry[]; canEdit: boolean; onClose: () => void; onDelete?: (so: PO) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editSO, setEditSO] = useState(false);
  if (!so) return null;
  const t = soTotals(so, entries);
  const mine = entries.filter((e) => e.so_id === so.id).sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
  const refresh = () => qc.invalidateQueries({ queryKey: ["so-entries"] });

  const save = async () => {
    if (!draft) return;
    const amt = Number(draft.amount);
    if (!(amt > 0)) { toast.error("Enter the amount"); return; }
    if (draft.kind === "invoice" && !draft.ref_no.trim()) { toast.error("Enter the invoice number"); return; }
    if (draft.kind === "invoice" && draft.taxable !== "" && Number(draft.taxable) > amt) { toast.error("Taxable amount can't be more than the invoice amount"); return; }
    setSaving(true);
    try {
      let doc_path: string | null = null, doc_name: string | null = null;
      if (draft.file) {
        if (draft.file.size > 25 * 1024 * 1024) throw new Error("The file is larger than 25 MB");
        const path = `${so.project_id}/so-${so.id}/${crypto.randomUUID()}-${draft.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, draft.file, { contentType: draft.file.type || undefined });
        if (upErr) throw upErr;
        doc_path = path; doc_name = draft.file.name;
      }
      const { error } = await sb.from("so_entries").insert({
        so_id: so.id, kind: draft.kind, entry_date: draft.entry_date || format(new Date(), "yyyy-MM-dd"),
        ref_no: draft.ref_no.trim() || null, amount: amt,
        taxable_amount: draft.kind === "invoice" && draft.taxable !== "" ? Number(draft.taxable) : null,
        notes: draft.notes.trim() || null, doc_path, doc_name,
      });
      if (error) throw new Error(/so_entries/.test(error.message) && /exist|schema/.test(error.message) ? "Run TRILO_so_billing.sql first" : error.message);
      toast.success(draft.kind === "invoice" ? "Invoice added" : "Payment received added");
      setDraft(null);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally { setSaving(false); }
  };
  const remove = async (e: SOEntry) => {
    if (!window.confirm(`Delete this ${e.kind === "invoice" ? "invoice" : "payment received"} of ${inr(e.amount)}?`)) return;
    const { error } = await sb.from("so_entries").delete().eq("id", e.id);
    if (error) { toast.error(error.message); return; }
    if (e.doc_path) supabase.storage.from(BUCKET).remove([e.doc_path]).catch(() => {});
    refresh();
  };
  const openDoc = async (path: string) => {
    try {
      await openFileLink(async () => {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
        if (error) throw error;
        return data.signedUrl;
      });
    } catch (err: any) { toast.error("Could not open the file: " + (err?.message ?? "")); }
  };

  const tiles: Array<[string, number, string]> = [
    ["SO value (with GST)", t.value, "text-ink-primary"],
    ["Billed", t.billed, "text-primary"],
    [t.balanceBilling < 0 ? "Billed over SO by" : "Balance billing", Math.abs(t.balanceBilling), t.balanceBilling < 0 ? "text-destructive" : "text-ink-primary"],
    ["Payment received", t.received, "text-success"],
    [t.balance < 0 ? "Received over SO by" : "Balance", Math.abs(t.balance), t.balance < 0 ? "text-destructive" : "text-warning"],
    // received more than billed → invoices still to raise ("Bill pending"); billed more than received → payment still to come
    t.outstanding > 0
      ? ["Payment pending", t.outstanding, "text-warning"]
      : ["Bill pending", -t.outstanding, -t.outstanding > 0 ? "text-warning" : "text-ink-primary"],
  ];

  return (
    <Dialog open={!!so} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto overflow-x-hidden [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            SO {so.po_number}
            {canEdit && <button type="button" onClick={() => setEditSO(true)} className="text-ink-muted hover:text-ink-primary" aria-label="Edit SO"><Pencil className="h-4 w-4" /></button>}
            {canEdit && onDelete && <button type="button" onClick={() => onDelete(so)} className="text-ink-muted hover:text-destructive" aria-label="Delete SO" title="Delete SO"><Trash2 className="h-4 w-4" /></button>}
          </DialogTitle>
          <DialogDescription>
            {[so.party, projectName, so.po_date ? format(new Date(so.po_date), "d MMM yyyy") : null].filter(Boolean).join(" · ")}
            {so.taxable_value != null ? ` · Taxable ${inr(Number(so.taxable_value))}` : ""}
          </DialogDescription>
        </DialogHeader>
        <POEditDialog projectId={so.project_id} projectName={projectName} po={so} kind="customer" open={editSO} onClose={() => setEditSO(false)} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map(([l, v, c]) => (
            <div key={l} className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] text-ink-muted">{l}</p>
              <p className={`font-heading text-base font-bold ${c}`}>{inr(v)}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div><div className="mb-1 flex justify-between text-xs text-ink-secondary"><span>Billed</span><span>{t.billedPct}%</span></div><Bar pct={t.billedPct} tone="bill" /></div>
          <div><div className="mb-1 flex justify-between text-xs text-ink-secondary"><span>Received</span><span>{t.receivedPct}%</span></div><Bar pct={t.receivedPct} tone="recv" /></div>
        </div>

        {so.doc_path && (
          <Button variant="outline" size="sm" className="w-fit max-w-full gap-1.5" onClick={() => openPODoc(so)}>
            <FileText className="h-4 w-4 shrink-0" /> <span className="min-w-0 truncate">{so.doc_name ?? "SO document"}</span> <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </Button>
        )}

        {canEdit && !draft && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => setDraft(emptyDraft("invoice"))}><Plus className="h-4 w-4" /> Add invoice (billing)</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setDraft(emptyDraft("receipt"))}><HandCoins className="h-4 w-4" /> Add payment received</Button>
          </div>
        )}

        {draft && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-sm font-semibold text-ink-primary">{draft.kind === "invoice" ? "New invoice" : "New payment received"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">{draft.kind === "invoice" ? "Invoice no. *" : "Reference (UTR / cheque no.)"}</label>
                <Input value={draft.ref_no} onChange={(e) => setDraft({ ...draft, ref_no: e.target.value })} className="h-10" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Date</label>
                <Input type="date" value={draft.entry_date} onChange={(e) => setDraft({ ...draft, entry_date: e.target.value })} className="h-10" />
              </div>
              {draft.kind === "invoice" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-muted">Taxable amount (₹, without GST)</label>
                  <Input type="number" inputMode="decimal" min="0" value={draft.taxable} onChange={(e) => setDraft({ ...draft, taxable: e.target.value })} className="h-10" />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-muted">{draft.kind === "invoice" ? "Invoice amount (₹, with GST) *" : "Amount received (₹) *"}</label>
                <Input type="number" inputMode="decimal" min="0" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className="h-10" />
              </div>
              <div className={draft.kind === "invoice" ? "sm:col-span-2" : ""}>
                <label className="mb-1 block text-xs font-medium text-ink-muted">Notes</label>
                <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="h-10" />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-muted">Attach {draft.kind === "invoice" ? "the invoice" : "proof"} (optional)</p>
              {draft.file
                ? <PickedFile file={draft.file} onRemove={() => setDraft({ ...draft, file: null })} />
                : <FilePickButtons onPick={(f) => setDraft({ ...draft, file: f })} />}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Invoices and payments received ({mine.length})</p>
          {!mine.length ? (
            <p className="py-4 text-center text-sm text-ink-muted">Nothing recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {mine.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.kind === "invoice" ? "bg-accent-light text-primary" : "bg-success-light text-success"}`}>
                    {e.kind === "invoice" ? "Invoice" : "Received"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink-primary">{e.ref_no ? (e.kind === "invoice" ? `Inv ${e.ref_no}` : e.ref_no) : e.kind === "invoice" ? "Invoice" : "Payment received"}</p>
                    <p className="text-xs text-ink-muted">
                      {format(new Date(e.entry_date), "d MMM yyyy")}
                      {e.taxable_amount != null ? ` · Taxable ${inr(Number(e.taxable_amount))} · GST ${inr(Number(e.amount) - Number(e.taxable_amount))}` : ""}
                      {e.notes ? ` · ${e.notes}` : ""}
                    </p>
                  </div>
                  <span className={`font-semibold ${e.kind === "invoice" ? "text-primary" : "text-success"}`}>{inr(Number(e.amount))}</span>
                  {e.doc_path && <button type="button" onClick={() => openDoc(e.doc_path!)} className="text-ink-muted hover:text-ink-primary" aria-label="Open file"><FileText className="h-4 w-4" /></button>}
                  {canEdit && <button type="button" onClick={() => remove(e)} className="text-ink-muted hover:text-destructive" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
