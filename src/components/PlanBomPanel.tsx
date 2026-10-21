// Production Plan → BOM tab: multi-level bill of materials for one project.
// Plan owner / admins / managers add, edit, reorder, delete and import lines;
// everyone can view and download it as Excel.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Plus, Upload, Download, Pencil, Trash2, ArrowUp, ArrowDown, ChevronRight, ChevronDown, Search, CornerDownRight, FileSpreadsheet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { saveFile } from "@/lib/nativeFiles";
import { useInvalidatePlan } from "@/components/ProductionPlanParts";
import { planError } from "@/lib/productionPlan";

const sb = supabase as any;

export type BomItem = {
  id: string; project_id: string; parent_id: string | null; sort_order: number;
  part_no: string | null; description: string; material: string | null; qty: number; unit: string;
  make_buy: "Make" | "Buy" | null; vendor: string | null; unit_cost: number | null;
  status: "required" | "ordered" | "received" | "issued"; remarks: string | null; created_at: string;
};
type Row = BomItem & { level: string; depth: number; hasKids: boolean; total: number };

export const BOM_STATUS: Array<{ key: BomItem["status"]; label: string; cls: string }> = [
  { key: "required", label: "Required", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { key: "ordered", label: "Ordered", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  { key: "received", label: "Received", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
  { key: "issued", label: "Issued", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
];
const statusOf = (s: string) => BOM_STATUS.find((x) => x.key === s) ?? BOM_STATUS[0];
const UNITS = ["Nos", "Set", "Kg", "m", "mm", "Ltr", "Sheet", "Pair", "Box", "Lot"];
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function useBom(projectId?: string) {
  return useQuery({
    queryKey: ["pp-bom", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await sb.from("pp_bom_items").select("*").eq("project_id", projectId)
        .order("sort_order").order("created_at");
      if (error) throw error;
      return (data ?? []) as BomItem[];
    },
  });
}

/** Tree → ordered rows with level numbers (1, 1.1, 1.2.1 …) and rolled-up totals. */
function flatten(items: BomItem[]): Row[] {
  const kids = new Map<string | null, BomItem[]>();
  items.forEach((i) => { const k = i.parent_id ?? null; kids.set(k, [...(kids.get(k) ?? []), i]); });
  kids.forEach((list) => list.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)));
  const totals = new Map<string, number>();
  const totalOf = (i: BomItem): number => {
    if (totals.has(i.id)) return totals.get(i.id)!;
    const own = i.unit_cost != null ? Number(i.qty) * Number(i.unit_cost) : 0;
    const t = own + (kids.get(i.id) ?? []).reduce((s, c) => s + totalOf(c), 0);
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

export default function PlanBomPanel({ projectId, projectName, canEdit }: { projectId: string; projectName: string; canEdit: boolean }) {
  const { data: items = [], isLoading, error } = useBom(projectId);
  const invalidate = useInvalidatePlan();
  const rows = useMemo(() => flatten(items), [items]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("");
  const [dialog, setDialog] = useState<null | { item?: BomItem; parentId?: string | null; parentLabel?: string }>(null);
  const [importOpen, setImportOpen] = useState(false);

  const refresh = () => { invalidate(); };
  const call = useMutation({
    mutationFn: async (a: { fn: string; args: Record<string, unknown> }) => {
      const { error } = await sb.rpc(a.fn, a.args);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e) => toast.error(planError(e)),
  });

  // hide children of collapsed assemblies; when searching/filtering show matches flat
  const filtering = !!q.trim() || !!statusF;
  const shown = useMemo(() => {
    if (filtering) {
      const k = q.trim().toLowerCase();
      return rows.filter((r) => (!statusF || r.status === statusF) &&
        (!k || `${r.part_no ?? ""} ${r.description} ${r.material ?? ""} ${r.vendor ?? ""}`.toLowerCase().includes(k)));
    }
    const hiddenUnder: string[] = [];
    return rows.filter((r) => {
      while (hiddenUnder.length && !r.level.startsWith(hiddenUnder[hiddenUnder.length - 1] + ".")) hiddenUnder.pop();
      if (hiddenUnder.length) return false;
      if (collapsed.has(r.id)) hiddenUnder.push(r.level);
      return true;
    });
  }, [rows, collapsed, filtering, q, statusF]);

  const grand = rows.filter((r) => r.depth === 0).reduce((s, r) => s + r.total, 0);
  const counts = BOM_STATUS.map((s) => ({ ...s, n: rows.filter((r) => r.status === s.key).length }));
  const siblings = (r: Row) => rows.filter((x) => x.parent_id === r.parent_id);

  const exportExcel = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOM");
    ws.addRow([`BOM — ${projectName}`]).font = { bold: true, size: 14 };
    ws.addRow([`Exported ${new Date().toLocaleString("en-IN")}`]);
    ws.addRow([]);
    const head = ws.addRow(["Level", "Part No.", "Description", "Material / Spec", "Qty", "Unit", "Make/Buy", "Vendor", "Unit Cost", "Total", "Status", "Remarks"]);
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6E6" } }; });
    rows.forEach((r) => {
      const row = ws.addRow([r.level, r.part_no ?? "", (r.depth ? "   ".repeat(r.depth) : "") + r.description, r.material ?? "", Number(r.qty), r.unit,
        r.make_buy ?? "", r.vendor ?? "", r.unit_cost != null ? Number(r.unit_cost) : "", r.total || "", statusOf(r.status).label, r.remarks ?? ""]);
      if (r.hasKids) row.font = { bold: true };
    });
    const tot = ws.addRow(["", "", "TOTAL", "", "", "", "", "", "", grand, "", ""]);
    tot.font = { bold: true };
    [8, 14, 44, 22, 8, 8, 10, 20, 12, 14, 12, 28].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.getColumn(9).numFmt = "#,##0.00"; ws.getColumn(10).numFmt = "#,##0.00";
    const buf = await wb.xlsx.writeBuffer();
    await saveFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `BOM - ${projectName.replace(/[\\/:*?"<>|]/g, "-")}.xlsx`);
  };

  if (error) return <p className="rounded-xl border border-border bg-card p-6 text-sm text-ink-muted">{planError(error).includes("not set up") ? "The BOM is not set up in the database yet — run the BOM SQL first." : planError(error)}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-9 gap-1.5" onClick={exportExcel} disabled={!rows.length}><Download className="h-4 w-4" /> Export Excel</Button>
          {canEdit && <Button variant="outline" className="h-9 gap-1.5" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import Excel</Button>}
          {canEdit && <Button className="h-9 gap-1.5" onClick={() => setDialog({ parentId: null })}><Plus className="h-4 w-4" /> Add line</Button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-border px-2.5 py-1 text-ink-secondary">{rows.length} line{rows.length === 1 ? "" : "s"}</span>
        {counts.filter((c) => c.n).map((c) => <span key={c.key} className={cn("rounded-full px-2.5 py-1", c.cls)}>{c.label}: {c.n}</span>)}
        <span className="rounded-full border border-border px-2.5 py-1 font-semibold text-ink-primary">Total cost: {inr(grand)}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="bg-muted/50 text-left text-ink-secondary">
            <tr>
              {["Level", "Part No.", "Description", "Material / Spec", "Qty", "Unit", "Make/Buy", "Vendor", "Unit Cost", "Total", "Status", "Remarks"].map((h) =>
                <th key={h} className={cn("px-3 py-2.5 font-medium whitespace-nowrap", ["Qty", "Unit Cost", "Total"].includes(h) && "text-right")}>{h}</th>)}
              {canEdit && <th className="px-3 py-2.5" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={13} className="px-3 py-8 text-center text-ink-muted">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={13} className="px-3 py-10 text-center text-ink-muted">
                {rows.length ? "No lines match." : canEdit ? "No BOM yet — click “Add line” or “Import Excel”." : "No BOM yet."}
              </td></tr>
            ) : shown.map((r) => {
              const sibs = siblings(r);
              const pos = sibs.findIndex((x) => x.id === r.id);
              return (
                <tr key={r.id} className={cn("border-t border-border align-top", r.hasKids && "bg-muted/20 font-medium")}>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-ink-secondary">{r.level}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.part_no ?? "—"}</td>
                  <td className="px-3 py-2 min-w-[220px]">
                    <div className="flex items-start gap-1" style={{ paddingLeft: filtering ? 0 : r.depth * 18 }}>
                      {r.hasKids && !filtering ? (
                        <button className="mt-0.5 text-ink-muted hover:text-ink-primary" aria-label={collapsed.has(r.id) ? "Expand" : "Collapse"}
                          onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>
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
                      <select value={r.status} aria-label="Status"
                        onChange={(e) => call.mutate({ fn: "pp_bom_save", args: { p_id: r.id, p_project_id: null, p_parent_id: null, p_fields: { status: e.target.value } } })}
                        className={cn("h-7 rounded-full border-0 px-2 text-xs font-medium", statusOf(r.status).cls)}>
                        {BOM_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    ) : <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusOf(r.status).cls)}>{statusOf(r.status).label}</span>}
                  </td>
                  <td className="px-3 py-2 max-w-[200px] whitespace-pre-wrap break-words">{r.remarks ?? ""}</td>
                  {canEdit && (
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-0.5">
                        <IconBtn label="Add sub-part" onClick={() => setDialog({ parentId: r.id, parentLabel: `${r.level} ${r.description}` })}><CornerDownRight className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Edit" onClick={() => setDialog({ item: r })}><Pencil className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Move up" disabled={pos <= 0 || call.isPending}
                          onClick={() => call.mutate({ fn: "pp_bom_move", args: { p_id: r.id, p_dir: -1 } })}><ArrowUp className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Move down" disabled={pos >= sibs.length - 1 || call.isPending}
                          onClick={() => call.mutate({ fn: "pp_bom_move", args: { p_id: r.id, p_dir: 1 } })}><ArrowDown className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Delete" danger onClick={() => {
                          if (window.confirm(`Delete "${r.description}"${r.hasKids ? " and every line under it" : ""}?`))
                            call.mutate({ fn: "pp_bom_delete", args: { p_id: r.id } });
                        }}><Trash2 className="h-4 w-4" /></IconBtn>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                <td colSpan={9} className="px-3 py-2.5 text-right">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{inr(grand)}</td>
                <td colSpan={canEdit ? 3 : 2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <BomLineDialog open={!!dialog} onClose={() => setDialog(null)} projectId={projectId} item={dialog?.item}
        parentId={dialog?.parentId ?? null} parentLabel={dialog?.parentLabel} onSaved={refresh} />
      <BomImportDialog open={importOpen} onClose={() => setImportOpen(false)} projectId={projectId} hasLines={rows.length > 0} onDone={refresh} />
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={cn("rounded p-1.5 text-ink-muted hover:bg-muted hover:text-ink-primary disabled:opacity-30 disabled:hover:bg-transparent",
        danger && "hover:text-destructive")}>
      {children}
    </button>
  );
}

// ── add / edit one line ──────────────────────────────────────────────────────
function BomLineDialog({ open, onClose, projectId, item, parentId, parentLabel, onSaved }: {
  open: boolean; onClose: () => void; projectId: string; item?: BomItem; parentId: string | null; parentLabel?: string; onSaved: () => void;
}) {
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!open) return;
    setF(item ? {
      part_no: item.part_no ?? "", description: item.description, material: item.material ?? "", qty: String(item.qty), unit: item.unit,
      make_buy: item.make_buy ?? "", vendor: item.vendor ?? "", unit_cost: item.unit_cost != null ? String(item.unit_cost) : "",
      status: item.status, remarks: item.remarks ?? "",
    } : { qty: "1", unit: "Nos", status: "required", make_buy: "" });
  }, [open, item]);

  const save = useMutation({
    mutationFn: async () => {
      if (!(f.description ?? "").trim()) throw new Error("Enter a description");
      const { error } = await sb.rpc("pp_bom_save", { p_id: item?.id ?? null, p_project_id: item ? null : projectId, p_parent_id: item ? null : parentId, p_fields: f });
      if (error) throw error;
    },
    onSuccess: () => { onSaved(); toast.success(item ? "BOM line updated" : "BOM line added"); onClose(); },
    onError: (e) => toast.error(planError(e)),
  });
  const sel = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const L = ({ t, children, wide }: { t: string; children: React.ReactNode; wide?: boolean }) => (
    <div className={wide ? "sm:col-span-2" : ""}><label className="mb-1.5 block text-sm font-medium text-ink-primary">{t}</label>{children}</div>
  );
  const total = (Number(f.qty) || 0) * (Number(f.unit_cost) || 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit BOM line" : parentId ? "Add sub-part" : "Add BOM line"}</DialogTitle>
          <DialogDescription>{parentId && !item ? `Under ${parentLabel}` : "Part details, quantity and cost."}</DialogDescription>
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
          <L t="Status">
            <select className={sel} value={f.status ?? "required"} onChange={(e) => set("status", e.target.value)}>
              {BOM_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </L>
          <L t="Remarks" wide><Input value={f.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} /></L>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2">
          <p className="text-sm text-ink-muted">{total ? `Line total: ${inr(total)}` : ""}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : item ? "Save" : "Add"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Excel import ─────────────────────────────────────────────────────────────
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
type ImportRow = { level: string; part_no: string; description: string; material: string; qty: string; unit: string;
  make_buy: string; vendor: string; unit_cost: string; status: string; remarks: string };

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as any;
    if (o.richText) return o.richText.map((t: any) => t.text).join("");
    if (o.result != null) return String(o.result);
    if (o.text != null) return String(o.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
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
  // header = first row (in the first 15) that has a description-like column
  const hIdx = grid.slice(0, 15).findIndex((r) => r.some((c) => /desc|item\s*name|particular/i.test(c)));
  if (hIdx < 0) throw new Error("Couldn't find the header row — it needs at least a “Description” column");
  const header = grid[hIdx];
  const colOf: Partial<Record<keyof ImportRow, number>> = {};
  header.forEach((h, i) => {
    for (const [key, re] of HEADER_MAP) {
      if (colOf[key] == null && re.test(h.trim())) {
        if (key === "make_buy" && !/buy/i.test(h)) continue;          // "Make" alone is usually the brand
        if (key === "vendor" && colOf.make_buy === i) continue;
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
  ws.addRow(["Level", "Part No.", "Description", "Material / Spec", "Qty", "Unit", "Make/Buy", "Vendor", "Unit Cost", "Status", "Remarks"]).font = { bold: true };
  ws.addRow(["1", "TRL-001", "Frame assembly", "", 1, "Set", "Make", "", "", "Required", "Top-level assembly"]);
  ws.addRow(["1.1", "TRL-001-01", "Side plate", "MS 5 mm", 2, "Nos", "Make", "", 1250, "Required", ""]);
  ws.addRow(["1.2", "", "Bolt M10 x 40", "GI", 8, "Nos", "Buy", "Local", 12, "Ordered", ""]);
  ws.addRow(["2", "", "Castor wheel 100 mm", "", 4, "Nos", "Buy", "", 900, "Required", ""]);
  [8, 14, 36, 18, 8, 8, 10, 16, 12, 12, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const buf = await wb.xlsx.writeBuffer();
  await saveFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "BOM template.xlsx");
}

function BomImportDialog({ open, onClose, projectId, hasLines, onDone }: {
  open: boolean; onClose: () => void; projectId: string; hasLines: boolean; onDone: () => void;
}) {
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
      const { data, error } = await sb.rpc("pp_bom_import", { p_project_id: projectId, p_rows: rows, p_replace: replace });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { onDone(); toast.success(`Imported ${n} BOM line${n === 1 ? "" : "s"}`); onClose(); },
    onError: (e) => toast.error(planError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import BOM from Excel</DialogTitle>
          <DialogDescription>
            First sheet, one row per part. Columns are matched by name: Level (1, 1.1, 1.2.1 …), Part No., Description, Material / Spec, Qty, Unit, Make/Buy, Vendor, Unit Cost, Status, Remarks.
          </DialogDescription>
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
                  <tr>{["Level", "Part No.", "Description", "Material", "Qty", "Unit", "Make/Buy", "Unit Cost", "Status"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1">{r.level || "—"}</td><td className="px-2 py-1">{r.part_no}</td>
                      <td className="px-2 py-1" style={{ paddingLeft: 8 + (Math.max(1, (r.level.match(/\./g)?.length ?? 0) + 1) - 1) * 14 }}>{r.description}</td>
                      <td className="px-2 py-1">{r.material}</td><td className="px-2 py-1">{r.qty}</td><td className="px-2 py-1">{r.unit}</td>
                      <td className="px-2 py-1">{r.make_buy}</td><td className="px-2 py-1">{r.unit_cost}</td><td className="px-2 py-1">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 200 && <p className="text-xs text-ink-muted">Showing the first 200 — all {rows.length} will be imported.</p>}
            {hasLines && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Replace the current BOM (otherwise these lines are added below it)
              </label>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!rows?.length || run.isPending}
            onClick={() => { if (!replace || window.confirm("Replace the whole BOM with this file? The current lines will be deleted.")) run.mutate(); }}>
            {run.isPending ? "Importing…" : `Import ${rows?.length ?? ""} line${rows?.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { Fragment };
