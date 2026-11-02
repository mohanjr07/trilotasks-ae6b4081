// ─────────────────────────────────────────────────────────────────────────────
//  Payslips
//  • Everyone: view & download their own payslips (PDF).
//  • Admins: view & download everyone's.
//  • anu@triloautomation.com: create / edit / delete payslips. Employee ID, Position
//    and Date of Joining come from the profile; PAN / Account / IFSC are remembered per
//    employee. Totals are worked out automatically.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Receipt, Plus, Download, Pencil, Trash2, Eye, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { downloadElementAsPdf } from "@/lib/formPdf";
import payslipLogo from "@/assets/payslip-logo.png";   // Trilo logo, trimmed to its edges

const sb = supabase as any;
export const PAYROLL_EDITOR_EMAILS = ["anu@triloautomation.com"];

type Line = { label: string; amount: number | null };
type Payslip = {
  id: string; user_id: string; pay_month: string; pay_date: string | null;
  employee_name: string; employee_code: string | null; position: string | null; date_of_joining: string | null;
  pan_number: string | null; account_number: string | null; ifsc_code: string | null;
  earnings: Line[]; deductions: Line[]; total_earnings: number; total_deductions: number; net_pay: number;
  created_at: string; updated_at: string;
};
type Person = { id: string; full_name: string; employee_code: string | null; position: string | null; joined_at: string | null; is_active: boolean };

const DEFAULT_EARNINGS = ["Basic Pay", "HRA", "Personal Allowance", "Overtime Allowance"];
const DEFAULT_DEDUCTIONS = ["PF", "Medical Insurance", "Professional Tax", "Loss of Pay"];
/** the standard lines are always there, even when copying an older payslip that didn't have them */
const withDefaults = (l: Line[], defaults: string[]) => [...l.map((x) => ({ ...x })),
  ...defaults.filter((d) => !l.some((x) => x.label.trim().toLowerCase() === d.toLowerCase())).map((label) => ({ label, amount: null }))];

const rupees = (n: number | null | undefined) => (n ? `₹ ${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "-");
const dmy = (d?: string | null) => (d ? format(new Date(d.length <= 10 ? d + "T00:00:00" : d), "dd/MM/yyyy") : "");
const monthLabel = (m: string) => format(new Date(m + "T00:00:00"), "MMM yyyy");
const sumLines = (l: Line[]) => l.reduce((s, x) => s + (Number(x.amount) || 0), 0);

export default function PayslipsPage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const email = (profile?.email ?? "").toLowerCase();
  const isEditor = PAYROLL_EDITOR_EMAILS.includes(email);
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const seeAll = isEditor || isAdmin;

  const [personFilter, setPersonFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");      // "01" … "12"
  const [order, setOrder] = useState<"new" | "old">("new");
  const [q, setQ] = useState("");
  const [view, setView] = useState<Payslip | null>(null);
  const [edit, setEdit] = useState<Payslip | "new" | null>(null);

  const { data: slips = [], isLoading, error } = useQuery({
    queryKey: ["payslips"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await sb.from("payslips").select("*").order("pay_month", { ascending: false }).order("employee_name");
      if (error) throw error;
      return (data ?? []) as Payslip[];
    },
  });
  const { data: people = [] } = useQuery({
    queryKey: ["payroll-people"],
    enabled: seeAll,
    queryFn: async () => {
      const { data, error } = await sb.rpc("payroll_people");
      if (!error && data?.length) return data as Person[];
      // payslips SQL not run yet (or it failed): fall back to the normal people list so names still show
      if (error) console.warn("payroll_people:", error.message);
      const { data: act, error: e2 } = await supabase.rpc("get_active_profiles");
      if (e2) throw e2;
      return ((act ?? []) as Array<{ id: string; full_name: string; position?: string | null }>).map((p) => ({
        id: p.id, full_name: p.full_name, employee_code: null, position: (p as any).position ?? null, joined_at: null, is_active: true,
      })).sort((a, b) => a.full_name.localeCompare(b.full_name)) as Person[];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("payslips").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payslips"] }); toast.success("Payslip deleted"); },
    onError: (e: any) => toast.error(e?.message ?? "Could not delete"),
  });

  const years = Array.from(new Set(slips.map((s) => s.pay_month.slice(0, 4)))).sort().reverse();
  const shown = slips.filter((s) => (!seeAll || personFilter === "all" || s.user_id === personFilter) &&
    (yearFilter === "all" || s.pay_month.slice(0, 4) === yearFilter) &&
    (monthFilter === "all" || s.pay_month.slice(5, 7) === monthFilter) &&
    (!q.trim() || `${s.employee_name} ${s.employee_code ?? ""} ${monthLabel(s.pay_month)}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (order === "new" ? b.pay_month.localeCompare(a.pay_month) : a.pay_month.localeCompare(b.pay_month)) || a.employee_name.localeCompare(b.employee_name));
  const byMonth = useMemo(() => {
    const m = new Map<string, Payslip[]>();
    shown.forEach((s) => m.set(s.pay_month, [...(m.get(s.pay_month) ?? []), s]));
    return Array.from(m.entries());
  }, [shown]);

  return (
    <AnimatedPage>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-xl sm:text-[28px] font-bold text-ink-primary">Payslips</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {isEditor ? "Create and edit payslips — each person can view and download their own."
              : isAdmin ? "Everyone's payslips." : "Your payslips — view and download as PDF."}
          </p>
        </div>
        {isEditor && <Button className="gap-1.5" onClick={() => setEdit("new")}><Plus className="h-4 w-4" /> New payslip</Button>}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Year" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select aria-label="Month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="all">All months</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) =>
            <option key={m} value={m}>{format(new Date(2000, Number(m) - 1, 1), "MMMM")}</option>)}
        </select>
        <select aria-label="Sort" value={order} onChange={(e) => setOrder(e.target.value as "new" | "old")} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
        </select>
        {(yearFilter !== "all" || monthFilter !== "all") && (
          <button type="button" className="text-xs font-medium text-primary" onClick={() => { setYearFilter("all"); setMonthFilter("all"); }}>Clear</button>
        )}
      </div>

      {seeAll && (
        <div className="mb-4 flex flex-wrap gap-2">
          <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className="h-9 max-w-[260px] rounded-md border border-input bg-background px-3 text-sm">
            <option value="all">All employees</option>
            {people.filter((p) => slips.some((s) => s.user_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <div className="relative sm:w-60">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID or month" className="h-9 pl-9" />
          </div>
        </div>
      )}

      {error ? (
        <EmptyState icon={Receipt} title="Payslips are not set up yet" description="Run the payslips SQL in Supabase, then reload." />
      ) : isLoading ? <div className="h-40 rounded-xl bg-muted animate-pulse" /> : !shown.length ? (
        <EmptyState icon={Receipt} title="No payslips yet" description={isEditor ? "Click “New payslip” to create one." : "Your payslips will appear here."} />
      ) : (
        <div className="space-y-5">
          {byMonth.map(([month, rows]) => (
            <div key={month}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{format(new Date(month + "T00:00:00"), "MMMM yyyy")}</p>
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {rows.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-primary">{s.employee_name}{s.employee_code ? ` · ${s.employee_code}` : ""}</p>
                      <p className="text-xs text-ink-muted">{s.position ?? "—"}{s.pay_date ? ` · Paid ${dmy(s.pay_date)}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-heading text-base font-bold text-ink-primary">{rupees(s.net_pay)}</p>
                      <p className="text-[11px] text-ink-muted">net pay</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setView(s)}><Eye className="h-3.5 w-3.5" /> View</Button>
                      {isEditor && <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setEdit(s)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
                      {isEditor && (
                        <button title="Delete" aria-label="Delete" className="rounded-md p-1.5 text-ink-muted hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => { if (window.confirm(`Delete ${s.employee_name}'s payslip for ${monthLabel(s.pay_month)}?`)) remove.mutate(s.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <PayslipViewer slip={view} onClose={() => setView(null)} />
      {isEditor && <PayslipEditor slip={edit} people={people} onClose={() => setEdit(null)} />}
    </AnimatedPage>
  );
}

// ── the slip itself (same layout as the Trilo payslip) ───────────────────────
export function PayslipSheet({ s }: { s: Pick<Payslip, "pay_date" | "employee_name" | "employee_code" | "position" | "date_of_joining" | "pan_number" | "account_number" | "ifsc_code" | "earnings" | "deductions"> }) {
  const te = sumLines(s.earnings), td = sumLines(s.deductions);
  const grad = "linear-gradient(90deg, #2c4bb5 0%, #8a2bd8 60%, #d61fbf 100%)";
  const row = (label: string, value: string, bold = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 8px", borderBottom: "1px solid #d6d6d6", fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
  const kv = (k: string, v?: string | null) => (
    <div style={{ display: "grid", gridTemplateColumns: "120px 18px 1fr", fontSize: 12, padding: "4px 0" }}>
      <span style={{ fontWeight: 600 }}>{k}</span><span>:</span><span>{v || "—"}</span>
    </div>
  );
  return (
    <div style={{ width: 794, minHeight: 1123, background: "#fff", color: "#222", fontFamily: "Poppins, Arial, sans-serif", position: "relative" }}>
      <div style={{ padding: "60px 64px 34px" }}>
        <img src={payslipLogo} alt="Trilo Automation" style={{ width: 175, height: "auto", display: "block", marginBottom: 44 }} />
        <div style={{ fontSize: 12, lineHeight: "22px" }}>
          {[["Pay Period", dmy(s.pay_date)], ["Employee Name", s.employee_name], ["Employee ID", s.employee_code ?? ""], ["Position", s.position ?? ""]].map(([k, v]) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "130px 22px 1fr" }}><span>{k}</span><span>:</span><span>{v}</span></div>
          ))}
        </div>
      </div>
      <div style={{ background: "#f3f3f3", padding: "36px 52px 90px" }}>
        <p style={{ textAlign: "center", fontSize: 22, fontWeight: 600, letterSpacing: 2, margin: "0 0 26px" }}>EMPLOYEE&nbsp;&nbsp;PAYSLIP</p>
        <div style={{ border: "2px solid #111", borderRadius: 10, background: "linear-gradient(180deg,#e2e2e2,#f7f7f7)", padding: "22px 24px 44px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, fontSize: 13 }}>
            <div>
              <p style={{ fontSize: 22, margin: "0 0 18px", background: grad, WebkitBackgroundClip: "text", color: "#4b3cc4" }}>EARNINGS</p>
              {s.earnings.map((l, i) => <div key={i}>{row(l.label, rupees(l.amount))}</div>)}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 8px", background: grad, color: "#fff", fontWeight: 700 }}>
                <span>Total Earnings</span><span>{rupees(te)}</span>
              </div>
            </div>
            <div>
              <p style={{ fontSize: 22, margin: "0 0 18px", color: "#4b3cc4" }}>DEDUCTIONS</p>
              {s.deductions.map((l, i) => <div key={i}>{row(l.label, rupees(l.amount))}</div>)}
              {row("Total Deduction", rupees(td), true)}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 8px", background: grad, color: "#fff", fontWeight: 700 }}>
                <span>Net Pay</span><span>{rupees(te - td)}</span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginTop: 24 }}>
            <div>{kv("Date of Joining", dmy(s.date_of_joining))}{kv("PAN Number", s.pan_number)}</div>
            <div>{kv("Account Number", s.account_number)}{kv("IFSC Code", s.ifsc_code)}</div>
          </div>
        </div>
      </div>
      <p style={{ position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center", fontSize: 9, color: "#444" }}>
        *This document has been automatically generated by computer; therefore, a signature is not required.
      </p>
    </div>
  );
}

function PayslipViewer({ slip, onClose }: { slip: Payslip | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (!ref.current || !slip) return;
    setBusy(true);
    try {
      await downloadElementAsPdf(ref.current, `Payslip ${slip.employee_name} ${monthLabel(slip.pay_month)}.pdf`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the PDF");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!slip} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[880px] max-h-[94dvh] overflow-y-auto p-3 sm:p-5">
        <DialogHeader>
          <DialogTitle>{slip ? `${slip.employee_name} — ${format(new Date(slip.pay_month + "T00:00:00"), "MMMM yyyy")}` : ""}</DialogTitle>
          <DialogDescription>Net pay {slip ? rupees(slip.net_pay) : ""}</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border border-border bg-neutral-200 p-2">
          <div className="origin-top-left" style={{ width: 794 }}>
            <div ref={ref}>{slip && <PayslipSheet s={slip} />}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button className="gap-1.5" disabled={busy} onClick={download}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Anu: create / edit ───────────────────────────────────────────────────────
function PayslipEditor({ slip, people, onClose }: { slip: Payslip | "new" | null; people: Person[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = slip === "new";
  const prevMonth = format(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), "yyyy-MM");
  const [userId, setUserId] = useState("");
  const [month, setMonth] = useState(prevMonth);
  const [payDate, setPayDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [code, setCode] = useState("");
  const [position, setPosition] = useState("");
  const [doj, setDoj] = useState("");
  const [pan, setPan] = useState("");
  const [acc, setAcc] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [earn, setEarn] = useState<Line[]>([]);
  const [ded, setDed] = useState<Line[]>([]);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!slip) return;
    setPreview(false);
    if (slip === "new") {
      setUserId(""); setMonth(prevMonth); setPayDate(format(new Date(), "yyyy-MM-dd"));
      setCode(""); setPosition(""); setDoj(""); setPan(""); setAcc(""); setIfsc("");
      setEarn(DEFAULT_EARNINGS.map((label) => ({ label, amount: null })));
      setDed(DEFAULT_DEDUCTIONS.map((label) => ({ label, amount: null })));
    } else {
      setUserId(slip.user_id); setMonth(slip.pay_month.slice(0, 7)); setPayDate(slip.pay_date ?? "");
      setCode(slip.employee_code ?? ""); setPosition(slip.position ?? ""); setDoj(slip.date_of_joining ?? "");
      setPan(slip.pan_number ?? ""); setAcc(slip.account_number ?? ""); setIfsc(slip.ifsc_code ?? "");
      setEarn(slip.earnings.map((l) => ({ ...l }))); setDed(slip.deductions.map((l) => ({ ...l })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slip]);

  // picking an employee fills ID / position / joining from the profile, and bank details + amounts from their last slip
  const pickEmployee = async (id: string) => {
    setUserId(id);
    const p = people.find((x) => x.id === id);
    setCode(p?.employee_code ?? ""); setPosition(p?.position ?? ""); setDoj(p?.joined_at?.slice(0, 10) ?? "");
    setPan(""); setAcc(""); setIfsc("");
    // everything the person filled in their Profile → Payroll details
    const [{ data: prof }, { data: last }] = await Promise.all([
      sb.rpc("payroll_profile", { p_user: id }),
      sb.from("payslips").select("earnings, deductions").eq("user_id", id).order("pay_month", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const pd = prof?.[0];
    if (pd) {
      setCode(pd.employee_code ?? p?.employee_code ?? ""); setPosition(pd.position ?? p?.position ?? "");
      setDoj(pd.joined_at?.slice(0, 10) ?? p?.joined_at?.slice(0, 10) ?? "");
      setPan(pd.pan_number ?? ""); setAcc(pd.account_number ?? ""); setIfsc(pd.ifsc_code ?? "");
    }
    if (!pd?.pan_number && !pd?.account_number) toast.message("This person hasn't filled their payroll details in Profile yet");
    if (last && isNew) { setEarn(withDefaults(last.earnings as Line[], DEFAULT_EARNINGS)); setDed(withDefaults(last.deductions as Line[], DEFAULT_DEDUCTIONS)); }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Choose the employee");
      if (!month) throw new Error("Choose the month");
      const p = people.find((x) => x.id === userId);
      const clean = (l: Line[]) => l.filter((x) => x.label.trim()).map((x) => ({ label: x.label.trim(), amount: x.amount == null || isNaN(Number(x.amount)) ? null : Number(x.amount) }));
      const row = {
        user_id: userId, pay_month: `${month}-01`, pay_date: payDate || null,
        employee_name: p?.full_name ?? (slip !== "new" && slip ? slip.employee_name : ""),
        employee_code: code.trim() || null, position: position.trim() || null, date_of_joining: doj || null,
        pan_number: pan.trim().toUpperCase() || null, account_number: acc.trim() || null, ifsc_code: ifsc.trim().toUpperCase() || null,
        earnings: clean(earn), deductions: clean(ded),
      };
      const res = isNew ? await sb.from("payslips").insert(row) : await sb.from("payslips").update(row).eq("id", (slip as Payslip).id);
      if (res.error) throw new Error(/duplicate|unique/i.test(res.error.message) ? "This employee already has a payslip for that month — edit it instead" : res.error.message);
      // remember the details for next month
      await sb.from("payroll_details").upsert({ user_id: userId, pan_number: row.pan_number, account_number: row.account_number, ifsc_code: row.ifsc_code, updated_at: new Date().toISOString() });
      await sb.rpc("set_payroll_profile", { p_user: userId, p_employee_code: row.employee_code, p_position: row.position, p_joined: row.date_of_joining });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslips"] }); qc.invalidateQueries({ queryKey: ["payroll-people"] });
      toast.success(isNew ? "Payslip created — the employee has been notified" : "Payslip updated"); onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  const lines = (title: string, l: Line[], set: (v: Line[]) => void) => (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink-primary">{title}</p>
      <div className="space-y-2">
        {l.map((x, i) => (
          <div key={i} className="flex gap-2">
            <Input value={x.label} onChange={(e) => set(l.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} className="h-9" />
            <Input type="number" min={0} step="any" placeholder="0" value={x.amount ?? ""} className="h-9 w-32 text-right"
              onChange={(e) => set(l.map((y, j) => (j === i ? { ...y, amount: e.target.value === "" ? null : Number(e.target.value) } : y)))} />
            <button type="button" aria-label="Remove line" className="rounded-md p-2 text-ink-muted hover:text-destructive" onClick={() => set(l.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-primary" onClick={() => set([...l, { label: "", amount: null }])}><Plus className="h-3.5 w-3.5" /> Add line</button>
      </div>
    </div>
  );
  const te = sumLines(earn), td = sumLines(ded);

  return (
    <Dialog open={!!slip} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`${preview ? "max-w-[880px]" : "sm:max-w-3xl"} max-h-[94dvh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{preview ? "Preview" : isNew ? "New payslip" : "Edit payslip"}</DialogTitle>
          <DialogDescription>Employee ID, Position and Date of Joining are saved on the person's profile; PAN and bank details are remembered for next month.</DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-neutral-200 p-2">
            <div style={{ width: 794 }}>
              <PayslipSheet s={{
                pay_date: payDate || null, employee_name: people.find((x) => x.id === userId)?.full_name ?? (slip !== "new" && slip ? slip.employee_name : "—"),
                employee_code: code.trim() || null, position: position.trim() || null, date_of_joining: doj || null,
                pan_number: pan.trim().toUpperCase() || null, account_number: acc.trim() || null, ifsc_code: ifsc.trim().toUpperCase() || null,
                earnings: earn.filter((x) => x.label.trim()), deductions: ded.filter((x) => x.label.trim()),
              }} />
            </div>
          </div>
        ) : (<>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Employee name *</label>
            <select value={userId} disabled={!isNew} onChange={(e) => pickEmployee(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-70">
              <option value="">Choose employee…</option>
              {people.filter((p) => p.is_active || p.id === userId).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">Salary month *</label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">Pay period (date)</label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
          <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">Employee ID</label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="#003" /></div>
          <div className="sm:col-span-3"><label className="mb-1.5 block text-sm font-medium text-ink-primary">Position</label><Input value={position} onChange={(e) => setPosition(e.target.value)} /></div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {lines("Earnings", earn, setEarn)}
          {lines("Deductions", ded, setDed)}
        </div>
        <div className="grid gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-3">
          <p>Total earnings: <b>{rupees(te)}</b></p><p>Total deduction: <b>{rupees(td)}</b></p><p>Net pay: <b>{rupees(te - td)}</b></p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">Date of Joining</label><Input type="date" value={doj} onChange={(e) => setDoj(e.target.value)} /></div>
          <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">Account Number</label><Input value={acc} onChange={(e) => setAcc(e.target.value)} /></div>
          <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">PAN Number</label><Input value={pan} onChange={(e) => setPan(e.target.value)} /></div>
          <div><label className="mb-1.5 block text-sm font-medium text-ink-primary">IFSC Code</label><Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} /></div>
        </div>
        </>)}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" className="mr-auto gap-1.5" onClick={() => setPreview((v) => !v)}>
            {preview ? <><Pencil className="h-4 w-4" /> Back to edit</> : <><Eye className="h-4 w-4" /> Preview</>}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : isNew ? "Create payslip" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
