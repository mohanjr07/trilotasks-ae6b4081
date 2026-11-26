// Admins: map one payment to several Purchase Orders, with the exact amount for each.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PO } from "@/components/PurchaseOrders";
import { usePaymentPOSplits, useProjectNames } from "@/components/POShares";
import { toast } from "sonner";

const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
type Line = { po_id: string; amount: string };

export default function PaymentPOSplitDialog({ payment, open, onClose, onSaved }: {
  payment: { id: string; amount?: number; purpose?: string; po_id?: string | null }; open: boolean; onClose: () => void; onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const { data: pos = [] } = useQuery({
    queryKey: ["purchase-orders"],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("purchase_orders").select("*").order("po_date", { ascending: false, nullsFirst: false });
      return (error ? [] : data ?? []) as PO[];
    },
  });
  const { data: splits = [] } = usePaymentPOSplits(open);
  const { data: projects = [] } = useProjectNames(open);
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const mine = splits.filter((s) => s.payment_id === payment.id);
    setLines(mine.length ? mine.map((s) => ({ po_id: s.po_id, amount: String(s.amount) }))
      : [{ po_id: payment.po_id ?? "", amount: "" }, { po_id: "", amount: "" }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payment.id, splits.length]);

  const vendorPOs = pos.filter((p) => p.kind === "vendor");
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  // amount of the payment (when opened from a PO's list, it is the total of its existing split)
  const payAmount = payment.amount ?? splits.filter((s) => s.payment_id === payment.id).reduce((a, s) => a + Number(s.amount), 0);
  const diff = Number(payAmount) - total;
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async (clear = false) => {
    const rows = clear ? [] : lines;
    if (!clear) {
      if (rows.length < 2) { toast.error("Add at least two POs"); return; }
      if (rows.some((l) => !l.po_id)) { toast.error("Pick a PO on every line"); return; }
      if (new Set(rows.map((l) => l.po_id)).size !== rows.length) { toast.error("Each PO can be listed only once"); return; }
      if (rows.some((l) => !(Number(l.amount) > 0))) { toast.error("Enter the amount for each PO"); return; }
      if (Math.abs(diff) > 1) { toast.error(`The PO amounts must add up to the payment ${inr(Number(payAmount))}`); return; }
    }
    setSaving(true);
    const { error } = await (supabase as any).rpc("set_payment_po_splits", {
      p_id: payment.id, p_splits: rows.map((l) => ({ po_id: l.po_id, amount: Number(l.amount) })),
    });
    setSaving(false);
    if (error) {
      toast.error(/set_payment_po_splits|function|schema cache/i.test(error.message) ? "Run TRILO_payment_multi_po.sql first" : error.message);
      return;
    }
    toast.success(clear ? "Split removed" : `Payment mapped to ${rows.length} POs`);
    ["payment-po-splits", "payment-requests", "project-expenses"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onSaved?.();
    onClose();
  };
  const hasSplit = splits.some((s) => s.payment_id === payment.id);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Split payment across POs</DialogTitle>
          <DialogDescription>{payment.purpose ? `${payment.purpose} · ` : ""}{inr(Number(payAmount))} — enter how much of it goes to each Purchase Order.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={l.po_id} onChange={(e) => set(i, { po_id: e.target.value })}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">Purchase Order…</option>
                {vendorPOs.map((p) => (
                  <option key={p.id} value={p.id}>PO {p.po_number}{p.party ? ` · ${p.party}` : ""}{projName(p.project_id) ? ` · ${projName(p.project_id)}` : ""}</option>
                ))}
              </select>
              <input type="number" inputMode="decimal" min="0" value={l.amount} placeholder="₹ amount"
                onChange={(e) => set(i, { amount: e.target.value })}
                className="h-10 w-28 rounded-md border border-input bg-background px-2 text-sm sm:w-36" />
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"
                className="p-1.5 text-ink-muted hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <button type="button" onClick={() => setLines([...lines, { po_id: "", amount: "" }])}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Add PO</button>
            <span className={Math.abs(diff) > 1 ? "font-semibold text-destructive" : "text-ink-muted"}>
              Total {inr(total)} · {Math.abs(diff) > 1 ? (diff > 0 ? `${inr(diff)} left` : `${inr(-diff)} over the payment`) : "matches the payment"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {hasSplit && <Button variant="outline" className="mr-auto text-destructive" disabled={saving} onClick={() => save(true)}>Remove split</Button>}
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving} className="gap-1.5">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
