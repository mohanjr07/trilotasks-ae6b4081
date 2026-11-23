// ─────────────────────────────────────────────────────────────────────────────
//  Invoices against a Purchase Order (the supplier's bills for this PO).
//  Only anu@triloautomation.com uploads / deletes them (also enforced in the
//  database — TRILO_po_invoices.sql); everyone who can see the PO can open them.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { FileText, Loader2, Plus, Trash2, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { openFileLink } from "@/lib/nativeFiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilePickButtons, PickedFile, type PO } from "@/components/PurchaseOrders";
import { toast } from "sonner";

const sb = supabase as any;
const BUCKET = "po-documents";
export const PO_INVOICE_UPLOADER = "anu@triloautomation.com";
const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Inv = { id: string; po_id: string; invoice_no: string; invoice_date: string | null; amount: number | null; notes: string | null; doc_path: string; doc_name: string | null; created_at: string };

export default function POInvoices({ po }: { po: PO }) {
  const { profile } = useAuth() as any;
  const canUpload = (profile?.email ?? "").toLowerCase() === PO_INVOICE_UPLOADER;
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [no, setNo] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: list = [], error } = useQuery({
    queryKey: ["po-invoices", po.id],
    queryFn: async () => {
      const { data, error } = await sb.from("po_invoices").select("*").eq("po_id", po.id).order("invoice_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Inv[];
    },
  });
  const total = list.reduce((s, i) => s + Number(i.amount || 0), 0);

  const reset = () => { setAdding(false); setNo(""); setAmount(""); setNotes(""); setFile(null); setDate(format(new Date(), "yyyy-MM-dd")); };
  const save = async () => {
    if (!no.trim()) { toast.error("Enter the invoice number"); return; }
    if (!file) { toast.error("Attach the invoice (photo or file)"); return; }
    if (file.size > 25 * 1024 * 1024) { toast.error("The file is larger than 25 MB"); return; }
    setSaving(true);
    try {
      const path = `${po.project_id}/po-${po.id}/inv-${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { error } = await sb.from("po_invoices").insert({
        po_id: po.id, invoice_no: no.trim(), invoice_date: date || null,
        amount: amount === "" ? null : Number(amount), notes: notes.trim() || null, doc_path: path, doc_name: file.name,
      });
      if (error) {
        supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw new Error(/po_invoices/.test(error.message) && /exist|schema/.test(error.message) ? "Run TRILO_po_invoices.sql first" : error.message);
      }
      toast.success("Invoice uploaded");
      reset();
      qc.invalidateQueries({ queryKey: ["po-invoices", po.id] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not upload");
    } finally { setSaving(false); }
  };
  const remove = async (i: Inv) => {
    if (!window.confirm(`Delete invoice ${i.invoice_no}?`)) return;
    const { error } = await sb.from("po_invoices").delete().eq("id", i.id);
    if (error) { toast.error(error.message); return; }
    supabase.storage.from(BUCKET).remove([i.doc_path]).catch(() => {});
    qc.invalidateQueries({ queryKey: ["po-invoices", po.id] });
  };
  const open = async (i: Inv) => {
    try {
      await openFileLink(async () => {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(i.doc_path, 300);
        if (error) throw error;
        return data.signedUrl;
      });
    } catch (e: any) { toast.error("Could not open the invoice: " + (e?.message ?? "")); }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="mr-auto text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Invoices against this PO ({list.length}){total > 0 ? ` · ${inr(total)}` : ""}
        </p>
        {canUpload && !adding && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Upload invoice</Button>
        )}
      </div>

      {adding && (
        <div className="mb-3 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Invoice no. *</label>
              <Input value={no} onChange={(e) => setNo(e.target.value)} className="h-10" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Invoice date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-muted">Amount (₹)</label>
              <Input type="number" inputMode="decimal" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-10" />
            </div>
          </div>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="h-10" />
          {file ? <PickedFile file={file} onRemove={() => setFile(null)} /> : <FilePickButtons onPick={setFile} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={reset} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Upload</Button>
          </div>
        </div>
      )}

      {error ? (
        <p className="rounded-lg border border-border p-3 text-sm text-ink-muted">Invoices aren't set up yet — run TRILO_po_invoices.sql.</p>
      ) : !list.length ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-ink-muted">No invoices uploaded yet.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {list.map((i) => (
            <div key={i.id} className="flex items-center gap-3 px-3 py-2">
              <Receipt className="h-4 w-4 shrink-0 text-ink-muted" />
              <button type="button" onClick={() => open(i)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium text-ink-primary">Inv {i.invoice_no}</p>
                <p className="truncate text-xs text-ink-muted">
                  {i.invoice_date ? format(new Date(i.invoice_date), "d MMM yyyy") : "No date"}{i.notes ? ` · ${i.notes}` : ""} · {i.doc_name ?? "file"}
                </p>
              </button>
              {i.amount != null && <span className="text-sm font-semibold text-ink-primary">{inr(Number(i.amount))}</span>}
              <button type="button" onClick={() => open(i)} className="p-1 text-ink-muted hover:text-ink-primary" aria-label="Open invoice"><FileText className="h-4 w-4" /></button>
              {canUpload && <button type="button" onClick={() => remove(i)} className="p-1 text-ink-muted hover:text-destructive" aria-label="Delete invoice"><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
