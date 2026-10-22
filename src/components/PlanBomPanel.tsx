// Production Plan → BOM tab.
// The BOM is built part by part. Anyone in the plan prepares a part (add lines, import
// Excel, or — as a revision — change / remove final lines) and sends it for approval.
// Approved parts are merged into ONE final BOM, which is locked (only the procurement
// status can be updated by the plan owner / admins / managers).
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Plus, Upload, Download, Pencil, Trash2, ArrowUp, ArrowDown, ChevronRight, ChevronDown, Search, CornerDownRight,
  FileSpreadsheet, ArrowLeft, Send, Check, Undo2, Replace, MinusCircle, Layers, Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { saveFile } from "@/lib/nativeFiles";
import { useInvalidatePlan } from "@/components/ProductionPlanParts";
import { planError, usePlanPeople, isAdmin, fmtDateTime } from "@/lib/productionPlan";

const sb = supabase as any;

export type BomItem = {
  id: string; project_id: string; parent_id: string | null; sort_order: number;
  part_no: string | null; description: string; material: string | null; qty: number; unit: string;
  make_buy: "Make" | "Buy" | null; vendor: string | null; unit_cost: number | null;
  status: "required" | "ordered" | "received" | "issued"; remarks: string | null; created_at: string;
  part_id: string | null; is_final: boolean; action: "add" | "change" | "remove"; replaces_id: string | null;
};
export type BomPart = {
  id: string; project_id: string; name: string; status: "draft" | "pending" | "approved" | "rejected";
  approver_id: string | null; note: string | null; comment: string | null; created_by: string | null;
  submitted_at: string | null; decided_by: string | null; decided_at: string | null; created_at: string; updated_at: string;
};
type Row = BomItem & { level: string; depth: number; hasKids: boolean; total: number };

export const BOM_STATUS: Array<{ key: BomItem["status"]; label: string; cls: string }> = [
  { key: "required", label: "Required", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { key: "ordered", label: "Ordered", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  { key: "received", label: "Received", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
  { key: "issued", label: "Issued", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
];
const statusOf = (s: string) => BOM_STATUS.find((x) => x.key === s) ?? BOM_STATUS[0];
const PART_STATUS: Record<BomPart["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  pending: { label: "Waiting for approval", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  approved: { label: "Approved — in final BOM", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  rejected: { label: "Sent back", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" },
};
const ACTION_CHIP: Record<BomItem["action"], { label: string; cls: string }> = {
  add: { label: "Add", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  change: { label: "Change", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
  remove: { label: "Remove", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" },
};
const UNITS = ["Nos", "Set", "Kg", "m", "mm", "Ltr", "Sheet", "Pair", "Box", "Lot"];
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const lineTotal = (i: Pick<BomItem, "qty" | "unit_cost">) => (i.unit_cost != null ? Number(i.qty) * Number(i.unit_cost) : 0);

export function useBom(projectId?: string) {
  return useQuery({
    queryKey: ["pp-bom", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await sb.from("pp_bom_items").select("*").eq("project_id", projectId).order("sort_order").order("created_at");
      if (error) throw error;
      return ((data ?? []) as BomItem[]).map((i) => ({ ...i, is_final: i.is_final ?? true, action: i.action ?? "add", part_id: i.part_id ?? null }));
    },
  });
}
export function useBomParts(projectId?: string) {
  return useQuery({
    queryKey: ["pp-bom", "parts", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await sb.from("pp_bom_parts").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BomPart[];
    },
  });
}

/** Tree → ordered rows with level numbers (1, 1.1, 1.2.1 …) and rolled-up totals.
 *  A line whose parent is not in the list is treated as a top line. */
function flatten(items: BomItem[]): Row[] {
  const ids = new Set(items.map((i) => i.id));
  const kids = new Map<string | null, BomItem[]>();
  items.forEach((i) => { const k = i.parent_id && ids.has(i.parent_id) ? i.parent_id : null; kids.set(k, [...(kids.get(k) ?? []), i]); });
  kids.forEach((list) => list.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)));
  const totals = new Map<string, number>();
  const totalOf = (i: BomItem): number => {
    if (totals.has(i.id)) return totals.get(i.id)!;
    const t = (i.action === "remove" ? 0 : lineTotal(i)) + (kids.get(i.id) ?? []).reduce((s, c) => s + totalOf(c), 0);
    totals.set(i.id, t);
    return t;
  };
  const out: Row[] = [];
  const walk = (parent: string | null, prefix: string, depth: number) => {
    (kids.get(parent) ?? []).forEach((i, idx) => {
      const level = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
      out.push({ ...i, level, depth, hasKids: (kids.get(i.id) ?? []).length > 0, total: totalOf(i) });
      walk(i.id, level, depth + 1);
    });
  };
  walk(null, "", 0);
  return out;
}

function useCollapse(rows: Row[]) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const visible = useMemo(() => {
    const hiddenUnder: string[] = [];
    return rows.filter((r) => {
      while (hiddenUnder.length && !r.level.startsWith(hiddenUnder[hiddenUnder.length - 1] + ".")) hiddenUnder.pop();
      if (hiddenUnder.length) return false;
      if (collapsed.has(r.id)) hiddenUnder.push(r.level);
      return true;
    });
  }, [rows, collapsed]);
  const toggle = (id: string) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return { visible, collapsed, toggle };
}

// ═════════════════════════════════════════════════════════════════════════════
export default function PlanBomPanel({ projectId, projectName, canEdit }: { projectId: string; projectName: string; canEdit: boolean }) {
  const { data: items = [], error } = useBom(projectId);
  const { data: parts = [], error: partsError } = useBomParts(projectId);
  const { user } = useAuth();
  const invalidate = useInvalidatePlan();
  const [view, setView] = useState<"final" | "parts">("final");
  const [openPart, setOpenPart] = useState<string | null>(null);
  const [newPart, setNewPart] = useState<null | { name: string; importAfter?: boolean }>(null);
  const [importPart, setImportPart] = useState<string | null>(null);

  const finalItems = useMemo(() => items.filter((i) => i.is_final), [items]);
  const waitingForMe = parts.filter((p) => p.status === "pending" && p.approver_id === user?.id).length;

  const createPart = useMutation({
    mutationFn: async (a: { name: string; importAfter?: boolean }) => {
      const { data, error } = await sb.rpc("pp_bom_part_create", { p_project_id: projectId, p_name: a.name });
      if (error) throw error;
      return { id: data as string, importAfter: a.importAfter };
    },
    onSuccess: ({ id, importAfter }) => { invalidate(); setNewPart(null); setView("parts"); setOpenPart(id); if (importAfter) setImportPart(id); },
    onError: (e) => toast.error(planError(e)),
  });

  if (error || partsError) {
    const m = planError(error ?? partsError);
    return <p className="rounded-xl border border-border bg-card p-6 text-sm text-ink-muted">{m.includes("not set up") || /pp_bom_parts/.test(String((partsError as any)?.message ?? "")) ? "BOM parts are not set up in the database yet — run the BOM parts SQL first." : m}</p>;
  }

  const part = openPart ? parts.find((p) => p.id === openPart) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {([["final", `Final BOM (${finalItems.length})`], ["parts", `Parts (${parts.length})`]] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setView(k); setOpenPart(null); }}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", view === k ? "bg-primary text-primary-foreground" : "text-ink-secondary hover:text-ink-primary")}>
              {label}
              {k === "parts" && waitingForMe > 0 && <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[11px] text-destructive-foreground">{waitingForMe}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-9 gap-1.5" onClick={() => setNewPart({ name: "", importAfter: true })}><Upload className="h-4 w-4" /> Import Excel as part</Button>
          <Button className="h-9 gap-1.5" onClick={() => setNewPart({ name: finalItems.length ? `Revision ${parts.filter((p) => p.status === "approved").length + 1}` : "" })}>
            <Plus className="h-4 w-4" /> {finalItems.length ? "New part / revision" : "New part"}
          </Button>
        </div>
      </div>

      {view === "final" && <FinalView items={finalItems} parts={parts} projectName={projectName} canEdit={canEdit} onRefresh={invalidate} />}
      {view === "parts" && !part && <PartsList parts={parts} items={items} onOpen={setOpenPart} />}
      {view === "parts" && part && (
        <PartView part={part} items={items} finalItems={finalItems} canManage={canEdit} onBack={() => setOpenPart(null)}
          onImport={() => setImportPart(part.id)} onDeleted={() => setOpenPart(null)} />
      )}

      <Dialog open={!!newPart} onOpenChange={(o) => !o && setNewPart(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{newPart?.importAfter ? "Import a BOM part from Excel" : "New BOM part"}</DialogTitle>
            <DialogDescription>Name the part (e.g. Frame, Electrical, Revision 2). You can add lines, then send it for approval.</DialogDescription>
          </DialogHeader>
          <Input autoFocus value={newPart?.name ?? ""} onChange={(e) => setNewPart((p) => (p ? { ...p, name: e.target.value } : p))} placeholder="Part name"
            onKeyDown={(e) => { if (e.key === "Enter" && newPart?.name.trim()) createPart.mutate({ name: newPart.name.trim(), importAfter: newPart.importAfter }); }} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setNewPart(null)}>Cancel</Button>
            <Button disabled={!newPart?.name.trim() || createPart.isPending}
              onClick={() => newPart && createPart.mutate({ name: newPart.name.trim(), importAfter: newPart.importAfter })}>
              {createPart.isPending ? "Creating…" : newPart?.importAfter ? "Create & choose file" : "Create part"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BomImportDialog open={!!importPart} onClose={() => setImportPart(null)} partId={importPart}
        hasLines={!!importPart && items.some((i) => i.part_id === importPart)} onDone={invalidate} />
    </div>
  );
}

// ── Final BOM (read-only, merged from approved parts) ────────────────────────
function FinalView({ items, parts, projectName, canEdit, onRefresh }: {
  items: BomItem[]; parts: BomPart[]; projectName: string; canEdit: boolean; onRefresh: () => void;
}) {
  const rows = useMemo(() => flatten(items), [items]);
  const { visible, collapsed, toggle } = useCollapse(rows);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("");
  const filtering = !!q.trim() || !!statusF;
  const shown = filtering
    ? rows.filter((r) => (!statusF || r.status === statusF) &&
        (!q.trim() || `${r.part_no ?? ""} ${r.description} ${r.material ?? ""} ${r.vendor ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())))
    : visible;
  const grand = rows.filter((r) => r.depth === 0).reduce((s, r) => s + r.total, 0);
  const partName = (id: string | null) => (id ? parts.find((p) => p.id === id)?.name ?? "—" : "Initial");

  const setStatus = useMutation({
    mutationFn: async (a: { id: string; status: string }) => {
      const { error } = await sb.rpc("pp_bom_final_status", { p_id: a.id, p_status: a.status });
      if (error) throw error;
    },
    onSuccess: onRefresh,
    onError: (e) => toast.error(planError(e)),
  });

  const exportExcel = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Final BOM");
    ws.addRow([`Final BOM — ${projectName}`]).font = { bold: true, size: 14 };
    ws.addRow([`Exported ${new Date().toLocaleString("en-IN")} · approved parts: ${parts.filter((p) => p.status === "approved").map((p) => p.name).join(", ") || "—"}`]);
    ws.addRow([]);
    const head = ws.addRow(["Level", "Part No.", "Description", "Material / Spec", "Qty", "Unit", "Make/Buy", "Vendor", "Unit Cost", "Total", "Status", "Remarks", "From part"]);
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6E6" } }; });
    rows.forEach((r) => {
      const row = ws.addRow([r.level, r.part_no ?? "", "   ".repeat(r.depth) + r.description, r.material ?? "", Number(r.qty), r.unit,
        r.make_buy ?? "", r.vendor ?? "", r.unit_cost != null ? Number(r.unit_cost) : "", r.total || "", statusOf(r.status).label, r.remarks ?? "", partName(r.part_id)]);
      if (r.hasKids) row.font = { bold: true };
    });
    ws.addRow(["", "", "TOTAL", "", "", "", "", "", "", grand, "", "", ""]).font = { bold: true };
    [8, 14, 44, 22, 8, 8, 10, 20, 12, 14, 12, 28, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(9).numFmt = "#,##0.00"; ws.getColumn(10).numFmt = "#,##0.00";
    const buf = await wb.xlsx.writeBuffer();
    await saveFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Final BOM - ${projectName.replace(/[\\/:*?"<>|]/g, "-")}.xlsx`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <div className="relative sm:w-60">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part, description, vendor" className="h-9 pl-9" />
          </div>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All statuses</option>
            {BOM_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <Button variant="outline" className="h-9 gap-1.5" onClick={exportExcel} disabled={!rows.length}><Download className="h-4 w-4" /> Export Excel</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-ink-secondary"><Lock className="h-3 w-3" /> Approved lines only — change through a new part</span>
        {BOM_STATUS.map((s) => ({ ...s, n: rows.filter((r) => r.status === s.key).length })).filter((c) => c.n).map((c) =>
          <span key={c.key} className={cn("rounded-full px-2.5 py-1", c.cls)}>{c.label}: {c.n}</span>)}
        <span className="rounded-full border border-border px-2.5 py-1 font-semibold text-ink-primary">Total cost: {inr(grand)}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="bg-muted/50 text-left text-ink-secondary">
            <tr>{["Level", "Part No.", "Description", "Material / Spec", "Qty", "Unit", "Make/Buy", "Vendor", "Unit Cost", "Total", "Status", "Remarks", "From part"].map((h) =>
              <th key={h} className={cn("px-3 py-2.5 font-medium whitespace-nowrap", ["Qty", "Unit Cost", "Total"].includes(h) && "text-right")}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={13} className="px-3 py-10 text-center text-ink-muted">{rows.length ? "No lines match." : "No approved BOM yet — add a part and send it for approval."}</td></tr>
            ) : shown.map((r) => (
              <tr key={r.id} className={cn("border-t border-border align-top", r.hasKids && "bg-muted/20 font-medium")}>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-ink-secondary">{r.level}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.part_no ?? "—"}</td>
                <td className="px-3 py-2 min-w-[220px]">
                  <div className="flex items-start gap-1" style={{ paddingLeft: filtering ? 0 : r.depth * 18 }}>
                    {r.hasKids && !filtering ? (
                      <button className="mt-0.5 text-ink-muted hover:text-ink-primary" aria-label="Expand or collapse" onClick={() => toggle(r.id)}>
                        {collapsed.has(r.id) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    ) : <span className="w-4 shrink-0" />}
                    <span className="break-words">{r.description}</span>
                  </div>
                </td>
                <td className="px-3 py-2">{r.material ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(r.qty)}</td>
                <td className="px-3 py-2">{r.unit}</td>
                <td className="px-3 py-2">{r.make_buy ?? "—"}</td>
                <td className="px-3 py-2">{r.vendor ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.unit_cost != null ? inr(Number(r.unit_cost)) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.total ? inr(r.total) : "—"}</td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <select value={r.status} aria-label="Status" onChange={(e) => setStatus.mutate({ id: r.id, status: e.target.value })}
                      className={cn("h-7 rounded-full border-0 px-2 text-xs font-medium", statusOf(r.status).cls)}>
                      {BOM_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  ) : <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusOf(r.status).cls)}>{statusOf(r.status).label}</span>}
                </td>
                <td className="px-3 py-2 max-w-[200px] whitespace-pre-wrap break-words">{r.remarks ?? ""}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-ink-muted">{partName(r.part_id)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="border-t-2 border-border bg-muted/40 font-semibold">
              <td colSpan={9} className="px-3 py-2.5 text-right">Total</td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{inr(grand)}</td>
              <td colSpan={3} />
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Parts list ───────────────────────────────────────────────────────────────
function PartsList({ parts, items, onOpen }: { parts: BomPart[]; items: BomItem[]; onOpen: (id: string) => void }) {
  const { nameOf } = usePlanPeople();
  if (!parts.length) return (
    <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-ink-muted">
      <Layers className="mx-auto mb-2 h-6 w-6" />
      No parts yet. Click “New part” or “Import Excel as part”, add the lines, then send it for approval.
    </div>
  );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {parts.map((p) => {
        const lines = items.filter((i) => i.part_id === p.id);
        const n = (a: BomItem["action"]) => lines.filter((l) => l.action === a).length;
        const total = lines.filter((l) => l.action !== "remove").reduce((s, l) => s + lineTotal(l), 0);
        return (
          <button key={p.id} onClick={() => onOpen(p.id)} className="rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:border-primary/50">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-ink-primary break-words">{p.name}</p>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", PART_STATUS[p.status].cls)}>{PART_STATUS[p.status].label}</span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">By {nameOf(p.created_by)} · {fmtDateTime(p.updated_at)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {n("add") > 0 && <span className={cn("rounded px-1.5 py-0.5", ACTION_CHIP.add.cls)}>+{n("add")} add</span>}
              {n("change") > 0 && <span className={cn("rounded px-1.5 py-0.5", ACTION_CHIP.change.cls)}>{n("change")} change</span>}
              {n("remove") > 0 && <span className={cn("rounded px-1.5 py-0.5", ACTION_CHIP.remove.cls)}>{n("remove")} remove</span>}
              {!lines.length && <span className="text-ink-muted">No lines yet</span>}
              {total > 0 && <span className="ml-auto font-medium text-ink-secondary">{inr(total)}</span>}
            </div>
            {p.status === "pending" && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Waiting for {nameOf(p.approver_id)}</p>}
            {p.status === "rejected" && p.comment && <p className="mt-2 text-xs text-red-600">Sent back: {p.comment}</p>}
            {p.status === "approved" && <p className="mt-2 text-xs text-green-700 dark:text-green-300">Approved by {nameOf(p.decided_by)} · {fmtDateTime(p.decided_at)}</p>}
          </button>
        );
      })}
    </div>
  );
}

// ── One part ─────────────────────────────────────────────────────────────────
function PartView({ part, items, finalItems, canManage, onBack, onImport, onDeleted }: {
  part: BomPart; items: BomItem[]; finalItems: BomItem[]; canManage: boolean; onBack: () => void; onImport: () => void; onDeleted: () => void;
}) {
  const { user, profile } = useAuth();
  const { nameOf, approvers } = usePlanPeople();
  const invalidate = useInvalidatePlan();
  const lines = useMemo(() => items.filter((i) => i.part_id === part.id), [items, part.id]);
  const rows = useMemo(() => flatten(lines), [lines]);
  const { visible, collapsed, toggle } = useCollapse(rows);
  const finalRows = useMemo(() => flatten(finalItems), [finalItems]);
  const finalById = useMemo(() => new Map(finalRows.map((r) => [r.id, r])), [finalRows]);

  const isAuthor = part.created_by === user?.id;
  const editable = (part.status === "draft" || part.status === "rejected") && (isAuthor || canManage);
  const canDecide = part.status === "pending" && !isAuthor && (part.approver_id === user?.id || isAdmin(profile?.role));
  const canWithdraw = part.status === "pending" && (isAuthor || canManage);

  const [lineDlg, setLineDlg] = useState<null | { item?: BomItem; parentId?: string | null; parentLabel?: string }>(null);
  const [pick, setPick] = useState<null | "change" | "remove">(null);
  const [send, setSend] = useState(false);
  const [decide, setDecide] = useState<null | "approve" | "reject">(null);
  const [rename, setRename] = useState<string | null>(null);

  const call = useMutation({
    mutationFn: async (a: { fn: string; args: Record<string, unknown>; ok?: string }) => {
      const { error } = await sb.rpc(a.fn, a.args);
      if (error) throw error;
      return a.ok;
    },
    onSuccess: (ok) => { invalidate(); if (ok) toast.success(ok); },
    onError: (e) => toast.error(planError(e)),
  });

  const total = lines.filter((l) => l.action !== "remove").reduce((s, l) => s + lineTotal(l), 0);
  const siblings = (r: Row) => rows.filter((x) => (x.parent_id ?? null) === (r.parent_id ?? null));
  const usedFinal = new Set(lines.filter((l) => l.replaces_id).map((l) => l.replaces_id));

  const was = (r: Row, k: keyof BomItem) => {
    if (r.action !== "change" || !r.replaces_id) return null;
    const f = finalById.get(r.replaces_id);
    if (!f || String(f[k] ?? "") === String(r[k] ?? "")) return null;
    return <span className="block text-[11px] text-ink-muted line-through">{k === "unit_cost" && f[k] != null ? inr(Number(f[k])) : String(f[k] ?? "—")}</span>;
  };

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary"><ArrowLeft className="h-4 w-4" /> All parts</button>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-lg font-bold text-ink-primary break-words">{part.name}</h3>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", PART_STATUS[part.status].cls)}>{PART_STATUS[part.status].label}</span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              By {nameOf(part.created_by)} · created {fmtDateTime(part.created_at)}
              {part.submitted_at && ` · sent ${fmtDateTime(part.submitted_at)} to ${nameOf(part.approver_id)}`}
              {part.decided_at && ` · ${part.status === "approved" ? "approved" : "decided"} by ${nameOf(part.decided_by)} ${fmtDateTime(part.decided_at)}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setRename(part.name)}><Pencil className="h-3.5 w-3.5" /> Rename</Button>}
            {editable && <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive"
              onClick={() => { if (window.confirm(`Delete the part "${part.name}" and its ${lines.length} line(s)?`)) call.mutate({ fn: "pp_bom_part_delete", args: { p_part_id: part.id }, ok: "Part deleted" }, { onSuccess: onDeleted }); }}>
              <Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
            {editable && <Button size="sm" className="h-8 gap-1.5" disabled={!lines.length} onClick={() => setSend(true)}><Send className="h-3.5 w-3.5" /> Send for approval</Button>}
            {canWithdraw && <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={call.isPending}
              onClick={() => call.mutate({ fn: "pp_bom_part_withdraw", args: { p_part_id: part.id }, ok: "Withdrawn — you can edit it again" })}><Undo2 className="h-3.5 w-3.5" /> Withdraw</Button>}
            {canDecide && <>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={() => setDecide("reject")}><Undo2 className="h-3.5 w-3.5" /> Send back</Button>
              <Button size="sm" className="h-8 gap-1.5 bg-green-600 hover:bg-green-700" onClick={() => setDecide("approve")}><Check className="h-3.5 w-3.5" /> Approve & merge</Button>
            </>}
          </div>
        </div>
        {part.note && <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm"><span className="text-ink-muted">Note from {nameOf(part.created_by)}:</span> {part.note}</p>}
        {part.comment && <p className={cn("mt-2 rounded-lg px-3 py-2 text-sm", part.status === "rejected" ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200" : "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200")}>
          <span className="opacity-70">{part.status === "rejected" ? "Sent back" : "Approver"} ({nameOf(part.decided_by)}):</span> {part.comment}</p>}
        {part.status === "approved" && <p className="mt-2 text-xs text-ink-muted">These lines are now part of the final BOM. To change them, create a new part.</p>}
      </div>

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button className="h-9 gap-1.5" onClick={() => setLineDlg({ parentId: null })}><Plus className="h-4 w-4" /> Add line</Button>
          <Button variant="outline" className="h-9 gap-1.5" onClick={onImport}><Upload className="h-4 w-4" /> Import Excel</Button>
          {finalItems.length > 0 && <Button variant="outline" className="h-9 gap-1.5" onClick={() => setPick("change")}><Replace className="h-4 w-4" /> Change a final line</Button>}
          {finalItems.length > 0 && <Button variant="outline" className="h-9 gap-1.5" onClick={() => setPick("remove")}><MinusCircle className="h-4 w-4" /> Remove a final line</Button>}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="bg-muted/50 text-left text-ink-secondary">
            <tr>
              {["Action", "Level", "Part No.", "Description", "Material / Spec", "Qty", "Unit", "Make/Buy", "Vendor", "Unit Cost", "Total", "Remarks"].map((h) =>
                <th key={h} className={cn("px-3 py-2.5 font-medium whitespace-nowrap", ["Qty", "Unit Cost", "Total"].includes(h) && "text-right")}>{h}</th>)}
              {editable && <th className="px-3 py-2.5" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={13} className="px-3 py-10 text-center text-ink-muted">{editable ? "No lines yet — add lines or import an Excel file." : "No lines."}</td></tr>
            ) : visible.map((r) => {
              const sibs = siblings(r); const pos = sibs.findIndex((x) => x.id === r.id);
              const underFinal = r.action === "add" && r.parent_id && finalById.get(r.parent_id);
              const target = r.replaces_id ? finalById.get(r.replaces_id) : null;
              return (
                <tr key={r.id} className={cn("border-t border-border align-top", r.action === "remove" && "text-ink-muted", r.hasKids && "font-medium")}>
                  <td className="px-3 py-2"><span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", ACTION_CHIP[r.action].cls)}>{ACTION_CHIP[r.action].label}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-ink-secondary">{target ? <span title="Line in the final BOM">{target.level}</span> : r.level}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.part_no ?? "—"}{was(r, "part_no")}</td>
                  <td className="px-3 py-2 min-w-[220px]">
                    <div className="flex items-start gap-1" style={{ paddingLeft: r.depth * 18 }}>
                      {r.hasKids ? (
                        <button className="mt-0.5 text-ink-muted hover:text-ink-primary" aria-label="Expand or collapse" onClick={() => toggle(r.id)}>
                          {collapsed.has(r.id) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      ) : <span className="w-4 shrink-0" />}
                      <span className={cn("break-words", r.action === "remove" && "line-through")}>
                        {r.description}{was(r, "description")}
                        {underFinal && <span className="block text-[11px] font-normal text-ink-muted">under final {underFinal.level} {underFinal.description}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.material ?? "—"}{was(r, "material")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.qty)}{was(r, "qty")}</td>
                  <td className="px-3 py-2">{r.unit}{was(r, "unit")}</td>
                  <td className="px-3 py-2">{r.make_buy ?? "—"}{was(r, "make_buy")}</td>
                  <td className="px-3 py-2">{r.vendor ?? "—"}{was(r, "vendor")}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.unit_cost != null ? inr(Number(r.unit_cost)) : "—"}{was(r, "unit_cost")}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{r.action === "remove" ? "—" : r.total ? inr(r.total) : "—"}</td>
                  <td className="px-3 py-2 max-w-[200px] whitespace-pre-wrap break-words">{r.remarks ?? ""}{was(r, "remarks")}</td>
                  {editable && (
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-0.5">
                        {r.action === "add" && <IconBtn label="Add sub-part" onClick={() => setLineDlg({ parentId: r.id, parentLabel: `${r.level} ${r.description}` })}><CornerDownRight className="h-4 w-4" /></IconBtn>}
                        {r.action !== "remove" && <IconBtn label="Edit" onClick={() => setLineDlg({ item: r })}><Pencil className="h-4 w-4" /></IconBtn>}
                        <IconBtn label="Move up" disabled={pos <= 0 || call.isPending} onClick={() => call.mutate({ fn: "pp_bom_line_move", args: { p_id: r.id, p_dir: -1 } })}><ArrowUp className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Move down" disabled={pos >= sibs.length - 1 || call.isPending} onClick={() => call.mutate({ fn: "pp_bom_line_move", args: { p_id: r.id, p_dir: 1 } })}><ArrowDown className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Delete line" danger onClick={() => {
                          if (window.confirm(`Delete "${r.description}" from this part${r.hasKids ? " (and the lines under it)" : ""}?`)) call.mutate({ fn: "pp_bom_line_delete", args: { p_id: r.id } });
                        }}><Trash2 className="h-4 w-4" /></IconBtn>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot><tr className="border-t-2 border-border bg-muted/40 font-semibold">
              <td colSpan={10} className="px-3 py-2.5 text-right">Part total (added / changed lines)</td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{inr(total)}</td>
              <td colSpan={editable ? 2 : 1} />
            </tr></tfoot>
          )}
        </table>
      </div>

      <BomLineDialog open={!!lineDlg} onClose={() => setLineDlg(null)} partId={part.id} item={lineDlg?.item}
        parentId={lineDlg?.parentId ?? null} parentLabel={lineDlg?.parentLabel} finalItem={lineDlg?.item?.replaces_id ? finalById.get(lineDlg.item.replaces_id) : undefined} />
      <PickFinalDialog mode={pick} onClose={() => setPick(null)} rows={finalRows.filter((r) => !usedFinal.has(r.id))} partId={part.id} />

      <Dialog open={send} onOpenChange={(o) => !o && setSend(false)}>
        <DialogContent className="sm:max-w-md">
          <SendForm approvers={approvers.filter((a) => a.id !== user?.id)} busy={call.isPending} onCancel={() => setSend(false)}
            onSend={(approver, note) => call.mutate({ fn: "pp_bom_part_submit", args: { p_part_id: part.id, p_approver: approver, p_note: note || null }, ok: "Sent for approval" }, { onSuccess: () => setSend(false) })} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!decide} onOpenChange={(o) => !o && setDecide(null)}>
        <DialogContent className="sm:max-w-md">
          <DecideForm mode={decide} busy={call.isPending} onCancel={() => setDecide(null)}
            onConfirm={(comment) => call.mutate({ fn: "pp_bom_part_decide", args: { p_part_id: part.id, p_approve: decide === "approve", p_comment: comment || null },
              ok: decide === "approve" ? "Approved — merged into the final BOM" : "Sent back" }, { onSuccess: () => setDecide(null) })} />
        </DialogContent>
      </Dialog>

      <Dialog open={rename !== null} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rename part</DialogTitle></DialogHeader>
          <Input autoFocus value={rename ?? ""} onChange={(e) => setRename(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRename(null)}>Cancel</Button>
            <Button disabled={!rename?.trim()} onClick={() => call.mutate({ fn: "pp_bom_part_rename", args: { p_part_id: part.id, p_name: rename?.trim() }, ok: "Renamed" }, { onSuccess: () => setRename(null) })}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SendForm({ approvers, busy, onCancel, onSend }: { approvers: Array<{ id: string; full_name: string }>; busy: boolean; onCancel: () => void; onSend: (approver: string, note: string) => void }) {
  const [approver, setApprover] = useState("");
  const [note, setNote] = useState("");
  return (
    <>
      <DialogHeader><DialogTitle>Send for approval</DialogTitle><DialogDescription>Once approved, the lines are merged into the final BOM.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-primary">Approver *</label>
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={approver} onChange={(e) => setApprover(e.target.value)}>
            <option value="">Choose…</option>
            {approvers.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-primary">Note (optional)</label>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's in this part / what changed" />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={busy} onClick={() => (approver ? onSend(approver, note.trim()) : toast.error("Choose who approves this part"))}>{busy ? "Sending…" : "Send"}</Button>
      </div>
    </>
  );
}

function DecideForm({ mode, busy, onCancel, onConfirm }: { mode: "approve" | "reject" | null; busy: boolean; onCancel: () => void; onConfirm: (comment: string) => void }) {
  const [comment, setComment] = useState("");
  useEffect(() => { setComment(""); }, [mode]);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "approve" ? "Approve and merge into the final BOM" : "Send back for changes"}</DialogTitle>
        <DialogDescription>{mode === "approve" ? "Added lines join the final BOM, changed lines update it, removed lines are taken out." : "The author can fix the part and send it again."}</DialogDescription>
      </DialogHeader>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-primary">{mode === "approve" ? "Comment (optional)" : "What should be fixed? *"}</label>
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button disabled={busy} className={mode === "approve" ? "bg-green-600 hover:bg-green-700" : ""}
          onClick={() => (mode === "reject" && !comment.trim() ? toast.error("Add a comment") : onConfirm(comment.trim()))}>
          {busy ? "Saving…" : mode === "approve" ? "Approve & merge" : "Send back"}
        </Button>
      </div>
    </>
  );
}

// choose a final line to change / remove
function PickFinalDialog({ mode, onClose, rows, partId }: { mode: null | "change" | "remove"; onClose: () => void; rows: Row[]; partId: string }) {
  const invalidate = useInvalidatePlan();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<Row | null>(null);
  useEffect(() => { if (mode) { setQ(""); setTarget(null); } }, [mode]);
  const remove = useMutation({
    mutationFn: async (r: Row) => {
      const { error } = await sb.rpc("pp_bom_line_save", { p_id: null, p_part_id: partId, p_parent_id: null, p_fields: { action: "remove", replaces_id: r.id } });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Added to this part as a removal"); onClose(); },
    onError: (e) => toast.error(planError(e)),
  });
  const shown = rows.filter((r) => !q.trim() || `${r.level} ${r.part_no ?? ""} ${r.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <Dialog open={!!mode && !target} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-xl max-h-[88dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === "change" ? "Change a line in the final BOM" : "Remove a line from the final BOM"}</DialogTitle>
            <DialogDescription>{mode === "remove" ? "Removing an assembly also removes everything under it, once approved." : "Pick the line, then enter the new values."}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the final BOM" className="h-9 pl-9" />
          </div>
          <div className="max-h-[50dvh] overflow-y-auto divide-y divide-border rounded-lg border border-border">
            {shown.length === 0 ? <p className="p-4 text-center text-sm text-ink-muted">No lines</p> : shown.map((r) => (
              <button key={r.id} disabled={remove.isPending}
                onClick={() => (mode === "change" ? setTarget(r) : window.confirm(`Remove "${r.description}"${r.hasKids ? " and everything under it" : ""} when this part is approved?`) && remove.mutate(r))}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted">
                <span className="w-12 shrink-0 tabular-nums text-ink-muted">{r.level}</span>
                <span className="min-w-0 flex-1 truncate" style={{ paddingLeft: r.depth * 12 }}>{r.part_no ? `${r.part_no} — ` : ""}{r.description}</span>
                <span className="text-xs text-ink-muted whitespace-nowrap">{Number(r.qty)} {r.unit}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <BomLineDialog open={!!target} onClose={() => { setTarget(null); onClose(); }} partId={partId} changeOf={target ?? undefined} parentId={null} />
    </>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={cn("rounded p-1.5 text-ink-muted hover:bg-muted hover:text-ink-primary disabled:opacity-30 disabled:hover:bg-transparent", danger && "hover:text-destructive")}>
      {children}
    </button>
  );
}

// ── add / edit one line in a part ────────────────────────────────────────────
function L({ t, children, wide }: { t: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : ""}><label className="mb-1.5 block text-sm font-medium text-ink-primary">{t}</label>{children}</div>;
}

function BomLineDialog({ open, onClose, partId, item, parentId, parentLabel, changeOf, finalItem }: {
  open: boolean; onClose: () => void; partId: string; item?: BomItem; parentId: string | null; parentLabel?: string;
  changeOf?: BomItem;        // creating a "change" line for this final line
  finalItem?: BomItem;       // editing a change line: the final line it changes
}) {
  const invalidate = useInvalidatePlan();
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!open) return;
    const src = item ?? changeOf;
    setF(src ? {
      part_no: src.part_no ?? "", description: src.description, material: src.material ?? "", qty: String(src.qty), unit: src.unit,
      make_buy: src.make_buy ?? "", vendor: src.vendor ?? "", unit_cost: src.unit_cost != null ? String(src.unit_cost) : "", remarks: src.remarks ?? "",
    } : { qty: "1", unit: "Nos", make_buy: "" });
  }, [open, item, changeOf]);

  const save = useMutation({
    mutationFn: async () => {
      if (!(f.description ?? "").trim()) throw new Error("Enter a description");
      const fields = changeOf ? { ...f, action: "change", replaces_id: changeOf.id } : f;
      const { error } = await sb.rpc("pp_bom_line_save", { p_id: item?.id ?? null, p_part_id: item ? null : partId, p_parent_id: item || changeOf ? null : parentId, p_fields: fields });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success(item ? "Line updated" : changeOf ? "Change added to this part" : "Line added"); onClose(); },
    onError: (e) => toast.error(planError(e)),
  });
  const sel = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const total = (Number(f.qty) || 0) * (Number(f.unit_cost) || 0);
  const base = changeOf ?? finalItem;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{changeOf ? "Change final BOM line" : item ? "Edit line" : parentId ? "Add sub-part" : "Add line"}</DialogTitle>
          <DialogDescription>
            {base ? `Now: ${base.part_no ? base.part_no + " — " : ""}${base.description} · ${Number(base.qty)} ${base.unit}${base.unit_cost != null ? " · " + inr(Number(base.unit_cost)) : ""}`
              : parentId && !item ? `Under ${parentLabel}` : "Part details, quantity and cost."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <L t="Part No."><Input value={f.part_no ?? ""} onChange={(e) => set("part_no", e.target.value)} placeholder="e.g. TRL-FR-001" /></L>
          <L t="Material / Spec"><Input value={f.material ?? ""} onChange={(e) => set("material", e.target.value)} placeholder="e.g. MS 5 mm, SS304" /></L>
          <L t="Description *" wide><Input value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Side plate" /></L>
          <L t="Qty"><Input type="number" min={0} step="any" value={f.qty ?? ""} onChange={(e) => set("qty", e.target.value)} /></L>
          <L t="Unit">
            <Input list="bom-units" value={f.unit ?? ""} onChange={(e) => set("unit", e.target.value)} />
            <datalist id="bom-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          </L>
          <L t="Make / Buy">
            <select className={sel} value={f.make_buy ?? ""} onChange={(e) => set("make_buy", e.target.value)}>
              <option value="">—</option><option value="Make">Make</option><option value="Buy">Buy</option>
            </select>
          </L>
          <L t="Vendor"><Input value={f.vendor ?? ""} onChange={(e) => set("vendor", e.target.value)} /></L>
          <L t="Unit cost (₹)"><Input type="number" min={0} step="any" value={f.unit_cost ?? ""} onChange={(e) => set("unit_cost", e.target.value)} /></L>
          <div />
          <L t="Remarks" wide><Input value={f.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} /></L>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2">
          <p className="text-sm text-ink-muted">{total ? `Line total: ${inr(total)}` : ""}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : item ? "Save" : changeOf ? "Add change" : "Add"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Excel import into a part ─────────────────────────────────────────────────
type ImportRow = { level: string; part_no: string; description: string; material: string; qty: string; unit: string;
  make_buy: string; vendor: string; unit_cost: string; status: string; remarks: string };
const HEADER_MAP: Array<[keyof ImportRow, RegExp]> = [
  ["level", /^(level|lvl|s\.?\s*no|sl\.?\s*no|item\s*no)/i],
  ["part_no", /part\s*(no|number|code)|item\s*code|^code$|drawing\s*no/i],
  ["description", /desc|item\s*name|^item$|^name$|particular/i],
  ["material", /material|spec/i],
  ["qty", /^qty|quantity|^nos?$/i],
  ["unit", /^unit$|uom|^units?$/i],
  ["make_buy", /make|buy/i],
  ["vendor", /vendor|supplier|make\s*by/i],
  ["unit_cost", /unit\s*(cost|price|rate)|^rate$|^price$|^cost$/i],
  ["status", /status/i],
  ["remarks", /remark|note|comment/i],
];

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as any;
    if (o.richText) return o.richText.map((t: any) => t.text).join("");
    if (o.result != null) return String(o.result);
    if (o.text != null) return String(o.text);
  }
  return String(v).trim();
}

async function readBomFile(file: File): Promise<ImportRow[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheets");
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (c, col) => { vals[col - 1] = cellText(c.value); });
    grid.push(Array.from(vals, (x) => x ?? ""));
  });
  const hIdx = grid.slice(0, 15).findIndex((r) => r.some((c) => /desc|item\s*name|particular/i.test(c)));
  if (hIdx < 0) throw new Error("Couldn't find the header row — it needs at least a “Description” column");
  const colOf: Partial<Record<keyof ImportRow, number>> = {};
  grid[hIdx].forEach((h, i) => {
    for (const [key, re] of HEADER_MAP) {
      if (colOf[key] == null && re.test(h.trim())) {
        if (key === "make_buy" && !/buy/i.test(h)) continue;
        colOf[key] = i; break;
      }
    }
  });
  return grid.slice(hIdx + 1).map((r) => {
    const g = (k: keyof ImportRow) => (colOf[k] != null ? r[colOf[k]!] ?? "" : "");
    return { level: g("level"), part_no: g("part_no"), description: g("description"), material: g("material"), qty: g("qty"),
      unit: g("unit"), make_buy: g("make_buy"), vendor: g("vendor"), unit_cost: g("unit_cost"), status: g("status"), remarks: g("remarks") };
  }).filter((r) => (r.description || r.part_no) && !/^total$/i.test(r.description.trim()));
}

async function downloadTemplate() {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOM");
  ws.addRow(["Level", "Part No.", "Description", "Material / Spec", "Qty", "Unit", "Make/Buy", "Vendor", "Unit Cost", "Remarks"]).font = { bold: true };
  ws.addRow(["1", "TRL-001", "Frame assembly", "", 1, "Set", "Make", "", "", "Top-level assembly"]);
  ws.addRow(["1.1", "TRL-001-01", "Side plate", "MS 5 mm", 2, "Nos", "Make", "", 1250, ""]);
  ws.addRow(["1.2", "", "Bolt M10 x 40", "GI", 8, "Nos", "Buy", "Local", 12, ""]);
  ws.addRow(["2", "", "Castor wheel 100 mm", "", 4, "Nos", "Buy", "", 900, ""]);
  [8, 14, 36, 18, 8, 8, 10, 16, 12, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const buf = await wb.xlsx.writeBuffer();
  await saveFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "BOM template.xlsx");
}

function BomImportDialog({ open, onClose, partId, hasLines, onDone }: { open: boolean; onClose: () => void; partId: string | null; hasLines: boolean; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [replace, setReplace] = useState(false);
  const [reading, setReading] = useState(false);
  useEffect(() => { if (open) { setRows(null); setFileName(""); setReplace(false); } }, [open]);

  const pick = async (file?: File) => {
    if (!file) return;
    setReading(true); setFileName(file.name);
    try { setRows(await readBomFile(file)); }
    catch (e: any) { setRows(null); toast.error(e?.message ?? "Couldn't read the file"); }
    finally { setReading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb.rpc("pp_bom_part_import", { p_part_id: partId, p_rows: rows, p_replace: replace });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { onDone(); toast.success(`Imported ${n} line${n === 1 ? "" : "s"} — check them, then send the part for approval`); onClose(); },
    onError: (e) => toast.error(planError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import lines from Excel</DialogTitle>
          <DialogDescription>First sheet, one row per part. Columns matched by name: Level (1, 1.1 …), Part No., Description, Material / Spec, Qty, Unit, Make/Buy, Vendor, Unit Cost, Remarks. After importing, send the part for approval.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Button className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={reading}><FileSpreadsheet className="h-4 w-4" /> {reading ? "Reading…" : "Choose .xlsx file"}</Button>
          <Button variant="outline" className="gap-1.5" onClick={downloadTemplate}><Download className="h-4 w-4" /> Download template</Button>
        </div>
        {rows && (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">{fileName}: <strong>{rows.length}</strong> line{rows.length === 1 ? "" : "s"} found.</p>
            <div className="max-h-[40dvh] overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="sticky top-0 bg-muted text-left text-ink-secondary">
                  <tr>{["Level", "Part No.", "Description", "Material", "Qty", "Unit", "Make/Buy", "Unit Cost"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1">{r.level || "—"}</td><td className="px-2 py-1">{r.part_no}</td>
                      <td className="px-2 py-1" style={{ paddingLeft: 8 + (r.level.match(/\./g)?.length ?? 0) * 14 }}>{r.description}</td>
                      <td className="px-2 py-1">{r.material}</td><td className="px-2 py-1">{r.qty}</td><td className="px-2 py-1">{r.unit}</td>
                      <td className="px-2 py-1">{r.make_buy}</td><td className="px-2 py-1">{r.unit_cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 200 && <p className="text-xs text-ink-muted">Showing the first 200 — all {rows.length} will be imported.</p>}
            {hasLines && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Replace this part's current lines (otherwise added below them)
              </label>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!rows?.length || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Importing…" : `Import ${rows?.length ?? ""} line${rows?.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
