// ─────────────────────────────────────────────────────────────────────────────
//  One Purchase Order used for 2–3 projects.
//  • po_allocations: each project's share of the PO value (exact amounts).
//  • A payment against the PO is either for ONE project (its own project), or for
//    the WHOLE PO (payment_requests.po_whole) — then it is split across the
//    projects by their share, and each project's expenses include its part.
//  (TRILO_po_shared_projects.sql)
// ─────────────────────────────────────────────────────────────────────────────
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, Split } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { PO } from "@/components/PurchaseOrders";

const sb = supabase as any;
const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

export type POAlloc = { id?: string; po_id: string; project_id: string; amount: number; notes?: string | null };
export type AllocDraft = { project_id: string; amount: string };

export function usePOAllocations(enabled = true) {
  return useQuery({
    queryKey: ["po-allocations"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from("po_allocations").select("*");
      if (error) return [] as POAlloc[];
      return (data ?? []) as POAlloc[];
    },
  });
}

export function useProjectNames(enabled = true) {
  return useQuery({
    queryKey: ["project-names"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").order("name");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });
}

/** Each project's share of the PO (one project at 100% when the PO isn't shared). */
export function sharesOf(po: PO, allocs: POAlloc[]) {
  const mine = allocs.filter((a) => a.po_id === po.id);
  if (!mine.length) return [{ project_id: po.project_id, amount: Number(po.value || 0), frac: 1 }];
  const tot = mine.reduce((s, a) => s + Number(a.amount || 0), 0);
  return mine.map((a) => ({ project_id: a.project_id, amount: Number(a.amount || 0), frac: tot > 0 ? Number(a.amount || 0) / tot : 1 / mine.length }));
}
export const isSharedPO = (po: PO, allocs: POAlloc[]) => sharesOf(po, allocs).length > 1;

/** POs of a project: its own POs and the ones shared with it. */
export const posOfProject = (projectId: string, pos: PO[], allocs: POAlloc[]) =>
  pos.filter((po) => po.project_id === projectId || allocs.some((a) => a.po_id === po.id && a.project_id === projectId));

type PayLike = { id: string; po_id?: string | null; project_id: string | null; amount: number; purpose: string; po_whole?: boolean | null };

/** Whole-PO payments → one line per project with that project's share (for project expenses). */
export function expandWholePOPayments<T extends PayLike>(rows: T[], pos: PO[], allocs: POAlloc[]): Array<T & { _shareOf?: string }> {
  const out: Array<T & { _shareOf?: string }> = [];
  for (const r of rows) {
    const po = r.po_whole && r.po_id ? pos.find((p) => p.id === r.po_id) : undefined;
    const shares = po ? sharesOf(po, allocs) : [];
    if (!po || shares.length < 2) { out.push(r); continue; }
    let left = Number(r.amount || 0);
    shares.forEach((s, i) => {
      const amt = i === shares.length - 1 ? round2(left) : round2(Number(r.amount || 0) * s.frac);
      left -= amt;
      out.push({ ...r, id: `${r.id}~${s.project_id}`, project_id: s.project_id, amount: amt,
        purpose: `${r.purpose} · ${Math.round(s.frac * 100)}% share of PO ${po.po_number}`, _shareOf: r.id });
    });
  }
  return out;
}

/** Save the split: replaces the PO's shares (nothing saved = PO belongs to its own project only). */
export async function saveAllocations(poId: string, rows: AllocDraft[]) {
  const { error: delErr } = await sb.from("po_allocations").delete().eq("po_id", poId);
  if (delErr) throw new Error(/po_allocations/.test(delErr.message) && /does not exist|schema cache|find the table/i.test(delErr.message)
    ? "Run TRILO_po_shared_projects.sql first" : delErr.message);
  if (rows.length < 2) return;
  const { error } = await sb.from("po_allocations").insert(rows.map((r) => ({ po_id: poId, project_id: r.project_id, amount: Number(r.amount) })));
  if (error) throw new Error(/row-level security/i.test(error.message) ? "Only admins and Anu can split a PO between projects" : error.message);
}

export function validateAllocations(rows: AllocDraft[], poValue: string): string | null {
  if (rows.length < 2) return "Add at least two projects, or turn off “Used for more than one project”";
  if (rows.some((r) => !r.project_id)) return "Pick a project on every line";
  if (new Set(rows.map((r) => r.project_id)).size !== rows.length) return "Each project can be listed only once";
  if (rows.some((r) => !(Number(r.amount) > 0))) return "Enter each project's amount";
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  if (poValue !== "" && Math.abs(total - Number(poValue)) > 1)
    return `The project amounts add up to ${inr(total)} — they must equal the PO value ${inr(Number(poValue))}`;
  return null;
}

/** Editor in the PO form: project + amount per line. */
export function POSharesEditor({ rows, onChange, poValue }: { rows: AllocDraft[]; onChange: (r: AllocDraft[]) => void; poValue: string }) {
  const { data: projects = [] } = useProjectNames();
  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const diff = poValue === "" ? 0 : Number(poValue) - total;
  const set = (i: number, patch: Partial<AllocDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-ink-muted">Enter each project's exact share of this PO.</p>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <select value={r.project_id} onChange={(e) => set(i, { project_id: e.target.value })}
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="number" inputMode="decimal" min="0" value={r.amount} placeholder="₹ amount"
            onChange={(e) => set(i, { amount: e.target.value })}
            className="h-10 w-28 rounded-md border border-input bg-background px-2 text-sm sm:w-36" />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove"
            className="p-1.5 text-ink-muted hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <button type="button" onClick={() => onChange([...rows, { project_id: "", amount: "" }])}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Add project</button>
        <span className={Math.abs(diff) > 1 && poValue !== "" ? "font-semibold text-destructive" : "text-ink-muted"}>
          Total {inr(total)}{poValue !== "" ? (Math.abs(diff) > 1 ? ` · ${diff > 0 ? `${inr(diff)} left to split` : `${inr(-diff)} over the PO value`}` : " · matches the PO value") : ""}
        </span>
      </div>
    </div>
  );
}

type SplitRow = { id: string; po_id?: string | null; project_id: string | null; amount: number; status: string; po_whole?: boolean | null };

/** PO detail: how the PO is split, and what's been paid for each project. */
export function POSplitView({ po, rows }: { po: PO; rows: SplitRow[] }) {
  const { data: allocs = [] } = usePOAllocations();
  const { data: projects = [] } = useProjectNames();
  const shares = sharesOf(po, allocs);
  if (shares.length < 2) return null;
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? "Project";
  const mine = rows.filter((r) => r.po_id === po.id && r.status === "approved");
  const whole = mine.filter((r) => r.po_whole).reduce((s, r) => s + Number(r.amount || 0), 0);
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"><Split className="h-3.5 w-3.5" /> Split across projects ({shares.length})</p>
      <div className="divide-y divide-border rounded-lg border border-border">
        {shares.map((s) => {
          const direct = mine.filter((r) => !r.po_whole && r.project_id === s.project_id).reduce((a, r) => a + Number(r.amount || 0), 0);
          const paid = direct + whole * s.frac;
          const bal = s.amount - paid;
          const pct = s.amount > 0 ? Math.round((paid / s.amount) * 100) : 0;
          return (
            <div key={s.project_id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink-primary">{name(s.project_id)}</p>
                <span className="text-xs text-ink-muted">{Math.round(s.frac * 100)}% · {inr(s.amount)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${pct > 100 ? "bg-destructive" : pct === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-ink-secondary">
                <span>Paid <b className="text-ink-primary">{inr(paid)}</b> ({pct}%)</span>
                <span className={bal < -1 ? "font-semibold text-destructive" : ""}>{bal < -1 ? "Over by " : "Balance "}<b>{inr(Math.abs(bal))}</b></span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-muted">Payments for the whole PO are split by each project's share; payments for one project count only for that project.</p>
    </div>
  );
}
