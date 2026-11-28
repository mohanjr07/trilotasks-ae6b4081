// ─────────────────────────────────────────────────────────────────────────────
//  AttendancePage.tsx
//  Biometric (eSSL) attendance: Daily · Date-wise · Weekly · Monthly.
//  Data comes from the `attendance` table + summary views (see migration
//  20260926000001_add_attendance.sql). Admins/managers see everyone;
//  employees see only their own rows (enforced by RLS).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import MobileSegments from "@/components/MobileSegments";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek, addDays, parseISO } from "date-fns";
import {
  Search, Users, CheckCircle2, AlertTriangle, Clock, FileSpreadsheet, Link2, Fingerprint,
  ChevronLeft, ChevronRight, Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer } from "@/components/AnimatedPage";
import StatCard from "@/components/StatCard";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { exportRowsToExcel, ExportColumn } from "@/lib/attendanceExport";
import { canSeeAttendance } from "@/lib/attendanceAccess";

// New tables/views aren't in the generated Supabase types yet.
const db = supabase as any;

type ViewKey = "daily" | "dates" | "weekly" | "monthly" | "yearly";

type Company = "all" | "Trilo" | "Mapl";

type AttendanceRow = {
  company: string | null;
  employee_id: string; user_id: string | null; employee_name: string | null; work_date: string;
  punch_in: string | null; punch_out: string | null; total_hours: number | null; punch_count: number;
  status?: string | null; source?: string | null;   // "register" = from the Sep–Oct attendance sheets (no punch times)
};
type DailySummaryRow = {
  company?: string | null;
  work_date: string; day: string; employees_present: number; missing_punch_out: number;
  total_hours: number; avg_hours_per_person: number | null; first_arrival: string | null;
  last_arrival: string | null; last_departure: string | null; who_was_present: string;
};
type PeriodRow = {
  company?: string | null;
  employee_id: string; employee_name: string | null; days_present: number; missing_punch_out: number;
  total_hours: number; avg_hours_per_day: number | null; earliest_in: string | null; latest_in: string | null;
  week_start?: string; week_end?: string; month?: string; month_name?: string;
};

// ── formatting helpers ───────────────────────────────────────────────────────
function fmtTime(t: string | null | undefined) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ampm}`;
}
/** Anything worked beyond 9 hours in a day is overtime. */
const OT_AFTER = 9;
/** Overtime is tracked only for machine IDs H01 – H11. */
const hasOvertime = (id?: string | null) => /^H\s*0?([1-9]|1[01])$/i.test((id ?? "").trim());
const otHours = (h: number | null | undefined) => (h != null && Number(h) > OT_AFTER ? Number(h) - OT_AFTER : 0);
const otOf = (r: { employee_id?: string | null; total_hours: number | null | undefined }) => (hasOvertime(r.employee_id) ? otHours(r.total_hours) : 0);
/** Clock time when overtime starts: punch-in + 9 hours. */
function otStart(punchIn: string | null | undefined) {
  if (!punchIn) return "";
  const [h, m] = punchIn.split(":").map(Number);
  const t = h * 60 + m + OT_AFTER * 60;
  return fmtTime(`${Math.floor(t / 60) % 24}:${String(t % 60).padStart(2, "0")}`);
}
function OtCell({ r }: { r: { employee_id: string; total_hours: number | null; punch_in: string | null } }) {
  const ot = otOf(r);
  if (!ot) return <span className="text-ink-muted">—</span>;
  return (
    <span>
      <span className="font-semibold text-primary">{fmtHours(ot)}</span>
      <span className="block text-[11px] text-ink-muted">after {otStart(r.punch_in)}</span>
    </span>
  );
}

function fmtHours(h: number | null | undefined) {
  if (h === null || h === undefined) return "—";
  const n = Number(h);
  const hrs = Math.floor(n);
  const mins = Math.round((n - hrs) * 60);
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`;
}
const fmtDate = (d: string) => format(parseISO(d), "EEE, d MMM yyyy");
const nameOf = (r: { employee_name: string | null; employee_id: string }) => r.employee_name || `ID ${r.employee_id}`;

// daily_summary has one row per date per company; combine them for "All companies"
function mergeByDate(rows: DailySummaryRow[]): DailySummaryRow[] {
  const map = new Map<string, DailySummaryRow>();
  for (const r of rows) {
    const m = map.get(r.work_date);
    if (!m) { map.set(r.work_date, { ...r }); continue; }
    const present = Number(m.employees_present) + Number(r.employees_present);
    const hours = Number(m.total_hours) + Number(r.total_hours);
    const minT = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
    const maxT = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
    map.set(r.work_date, {
      ...m,
      employees_present: present,
      missing_punch_out: Number(m.missing_punch_out) + Number(r.missing_punch_out),
      total_hours: hours,
      avg_hours_per_person: present ? Number((hours / present).toFixed(2)) : null,
      first_arrival: minT(m.first_arrival, r.first_arrival),
      last_arrival: maxT(m.last_arrival, r.last_arrival),
      last_departure: maxT(m.last_departure, r.last_departure),
      who_was_present: [m.who_was_present, r.who_was_present].filter(Boolean).join(", "),
    });
  }
  return [...map.values()].sort((a, b) => b.work_date.localeCompare(a.work_date));
}

function CompanyBadge({ c }: { c?: string | null }) {
  if (!c) return null;
  const cls = c === "Mapl" ? "bg-purple-light text-purple" : "bg-accent-light text-primary";
  return <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-pill align-middle ${cls}`}>{c}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AttendancePage() {
  const { user, profile } = useAuth();
  // everyone's attendance: admins, managers and Anu
  const isAdminView = ["admin", "manager", "super_admin"].includes(profile?.role ?? "") || canSeeAttendance(profile as any);
  const isStrictAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const today = format(new Date(), "yyyy-MM-dd");
  const [view, setView] = useState<ViewKey>("daily");
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState<Company>("all");
  const byCompany = (q: any) => (company === "all" ? q : q.eq("company", company));
  const [showLink, setShowLink] = useState(false);
  const [showRange, setShowRange] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const weekStart = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(addDays(parseISO(weekStart), 6), "yyyy-MM-dd");
  const monthStart = `${month}-01`;
  const monthEnd = format(addDays(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1), -1), "yyyy-MM-dd");

  const tabs: { key: ViewKey; label: string }[] = isAdminView
    ? [
        { key: "daily", label: "Daily" },
        { key: "dates", label: "Date-wise" },
        { key: "weekly", label: "Weekly" },
        { key: "monthly", label: "Monthly" },
        { key: "yearly", label: "1 Year" },
      ]
    : [
        { key: "daily", label: "Daily" },
        { key: "weekly", label: "Weekly" },
        { key: "monthly", label: "Monthly" },
        { key: "yearly", label: "1 Year" },
      ];

  // ── Data ───────────────────────────────────────────────────────────────────
  // Admin daily = everyone on one date. Employee daily = own rows for the month.
  const dailyQ = useQuery({
    queryKey: ["attendance-daily", isAdminView, date, month, user?.id, company],
    enabled: view === "daily" && !!user,
    queryFn: async () => {
      let q = byCompany(db.from("attendance").select("*"));
      q = isAdminView
        ? q.eq("work_date", date).order("employee_id")
        : q.eq("user_id", user!.id).gte("work_date", monthStart).lte("work_date", monthEnd).order("work_date", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AttendanceRow[];
    },
  });

  const datesQ = useQuery({
    queryKey: ["attendance-dates", month, company],
    enabled: view === "dates" && isAdminView,
    queryFn: async () => {
      const { data, error } = await byCompany(db.from("daily_summary").select("*"))
        .gte("work_date", monthStart).lte("work_date", monthEnd).order("work_date", { ascending: false });
      if (error) throw error;
      return mergeByDate((data ?? []) as DailySummaryRow[]);
    },
  });

  const weeklyQ = useQuery({
    queryKey: ["attendance-weekly", weekStart, company],
    enabled: view === "weekly",
    queryFn: async () => {
      const { data, error } = await byCompany(db.from("weekly_attendance").select("*")).eq("week_start", weekStart).order("employee_id");
      if (error) throw error;
      return (data ?? []) as PeriodRow[];
    },
  });

  // overtime per person for the week / month / 12 months (TRILO_attendance_overtime.sql)
  const otQ = useQuery({
    queryKey: ["attendance-ot", view, weekStart, month, company],
    enabled: view === "weekly" || view === "monthly" || view === "yearly",
    queryFn: async () => {
      const q = view === "weekly"
        ? db.from("attendance_overtime_weekly").select("employee_id, overtime_hours, overtime_days").eq("week_start", weekStart)
        : db.from("attendance_overtime_monthly").select("employee_id, month, overtime_hours, overtime_days")
            .in("month", view === "monthly" ? [month] : Array.from({ length: 12 }, (_, i) => format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 12 + i, 1), "yyyy-MM")));
      const { data, error } = await q.range(0, 9999);
      if (error) return {} as Record<string, { hours: number; days: number }>;     // SQL not run yet → no overtime column values
      const m: Record<string, { hours: number; days: number }> = {};
      for (const x of (data ?? []) as any[]) {
        const e = (m[x.employee_id] ??= { hours: 0, days: 0 });
        e.hours += Number(x.overtime_hours || 0); e.days += Number(x.overtime_days || 0);
      }
      return m;
    },
  });
  const otFor = (id: string) => (hasOvertime(id) ? otQ.data?.[id] : undefined);   // only H01 – H11

  const monthlyQ = useQuery({
    queryKey: ["attendance-monthly", month, company],
    enabled: view === "monthly",
    queryFn: async () => {
      const { data, error } = await byCompany(db.from("monthly_attendance").select("*")).eq("month", month).order("employee_id");
      if (error) throw error;
      return (data ?? []) as PeriodRow[];
    },
  });

  const matches = (r: { employee_id?: string; employee_name?: string | null }) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (r.employee_name ?? "").toLowerCase().includes(s) || (r.employee_id ?? "").toLowerCase().includes(s);
  };

  // 1 Year: the 12 months up to the chosen month
  const yearMonths = useMemo(() => {
    const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1;
    return Array.from({ length: 12 }, (_, i) => format(new Date(y, m - 11 + i, 1), "yyyy-MM"));
  }, [month]);
  const yearlyQ = useQuery({
    queryKey: ["attendance-yearly", month, company],
    enabled: view === "yearly",
    queryFn: async () => {
      const all: PeriodRow[] = [];
      for (let off = 0; off < 20000; off += 1000) {
        const { data, error } = await byCompany(db.from("monthly_attendance").select("*"))
          .in("month", yearMonths).order("employee_id").order("month").range(off, off + 999);
        if (error) throw error;
        all.push(...((data ?? []) as PeriodRow[]));
        if (!data || data.length < 1000) break;
      }
      return all;
    },
  });
  type YearRow = PeriodRow & { byMonth: Record<string, PeriodRow> };
  const yearlyRows = useMemo<YearRow[]>(() => {
    const map = new Map<string, YearRow>();
    for (const r of yearlyQ.data ?? []) {
      let y = map.get(r.employee_id);
      if (!y) { y = { ...r, days_present: 0, missing_punch_out: 0, total_hours: 0, avg_hours_per_day: null, byMonth: {} }; map.set(r.employee_id, y); }
      y.byMonth[r.month ?? ""] = r;
      y.days_present += Number(r.days_present);
      y.missing_punch_out += Number(r.missing_punch_out);
      y.total_hours += Number(r.total_hours);
      if (r.employee_name) y.employee_name = r.employee_name;
    }
    return [...map.values()].map((y) => ({ ...y, avg_hours_per_day: y.days_present ? y.total_hours / y.days_present : null })).filter(matches);
  }, [yearlyQ.data, search]);

  const activeQ = { daily: dailyQ, dates: datesQ, weekly: weeklyQ, monthly: monthlyQ, yearly: yearlyQ }[view];


  const dailyRows = useMemo(() => (dailyQ.data ?? []).filter(matches), [dailyQ.data, search]);
  const weeklyRows = useMemo(() => (weeklyQ.data ?? []).filter(matches), [weeklyQ.data, search]);
  const monthlyRows = useMemo(() => (monthlyQ.data ?? []).filter(matches), [monthlyQ.data, search]);
  const dateRows = datesQ.data ?? [];

  // ── Stat cards ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const rows =
      view === "daily" ? dailyRows :
      view === "weekly" ? weeklyRows :
      view === "monthly" ? monthlyRows :
      view === "yearly" ? yearlyRows : [];
    if (view === "dates") {
      const days = dateRows.length;
      const avgPresent = days ? dateRows.reduce((s, r) => s + Number(r.employees_present), 0) / days : 0;
      const missing = dateRows.reduce((s, r) => s + Number(r.missing_punch_out), 0);
      const hours = dateRows.reduce((s, r) => s + Number(r.total_hours), 0);
      return [
        { title: "Working days", value: days, icon: Clock, sub: "days with punches" },
        { title: "Avg present / day", value: Math.round(avgPresent), icon: Users, sub: avgPresent.toFixed(1) },
        { title: "Missing punch-outs", value: missing, icon: AlertTriangle, warn: true },
        { title: "Total hours", value: Math.round(hours), icon: CheckCircle2, sub: fmtHours(hours) },
      ];
    }
    if (view === "daily") {
      const r = rows as AttendanceRow[];
      const complete = r.filter((x) => x.punch_out || x.source === "register").length;
      const withHours = r.filter((x) => x.total_hours !== null);
      const avg = withHours.length ? withHours.reduce((s, x) => s + Number(x.total_hours), 0) / withHours.length : 0;
      return [
        { title: isAdminView ? "Present" : "Days present", value: r.length, icon: Users },
        { title: "Punched in & out", value: complete, icon: CheckCircle2 },
        { title: "Missing punch-out", value: r.length - complete, icon: AlertTriangle, warn: true },
        { title: "Avg hours", value: Math.round(avg), icon: Clock, sub: fmtHours(avg) },
      ];
    }
    const r = rows as PeriodRow[];
    const totalDays = r.reduce((s, x) => s + Number(x.days_present), 0);
    const hours = r.reduce((s, x) => s + Number(x.total_hours), 0);
    const missing = r.reduce((s, x) => s + Number(x.missing_punch_out), 0);
    return [
      { title: "Employees", value: r.length, icon: Users },
      { title: "Days present (total)", value: totalDays, icon: CheckCircle2 },
      { title: "Missing punch-outs", value: missing, icon: AlertTriangle, warn: true },
      { title: "Total hours", value: Math.round(hours), icon: Clock, sub: fmtHours(hours) },
    ];
  }, [view, dailyRows, weeklyRows, monthlyRows, yearlyRows, dateRows, isAdminView]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      if (view === "daily") {
        const cols: ExportColumn[] = [
          ...(isAdminView ? [{ header: "Employee ID", key: "employee_id", width: 12 }, { header: "Name", key: "name", width: 26 }, { header: "Company", key: "company", width: 10 }] : []),
          { header: "Date", key: "work_date", width: 14 },
          { header: "Punch In", key: "in", width: 12 },
          { header: "Punch Out", key: "out", width: 12 },
          { header: "Hours", key: "total_hours", width: 10 },
          { header: "Overtime (h)", key: "ot", width: 12 },
          { header: "Overtime from", key: "ot_from", width: 13 },
        ];
        const rows = dailyRows.map((r) => ({ ...r, name: nameOf(r), in: fmtTime(r.punch_in), out: fmtTime(r.punch_out),
          ot: otOf(r) ? Math.round(otOf(r) * 100) / 100 : "", ot_from: otOf(r) ? otStart(r.punch_in) : "" }));
        const label = isAdminView ? date : month;
        await exportRowsToExcel(`attendance-daily-${label}${company === "all" ? "" : "-" + company}`, "Daily", `Attendance — ${isAdminView ? fmtDate(date) : format(parseISO(monthStart), "MMMM yyyy")}`, cols, rows);
      } else if (view === "dates") {
        const cols: ExportColumn[] = [
          { header: "Date", key: "work_date", width: 14 }, { header: "Day", key: "day", width: 8 },
          { header: "Present", key: "employees_present", width: 10 }, { header: "Missing Out", key: "missing_punch_out", width: 12 },
          { header: "Avg Hours", key: "avg_hours_per_person", width: 11 }, { header: "First In", key: "first", width: 11 },
          { header: "Last Out", key: "last", width: 11 }, { header: "Who was present", key: "who_was_present", width: 60 },
        ];
        const rows = dateRows.map((r) => ({ ...r, first: fmtTime(r.first_arrival), last: fmtTime(r.last_departure) }));
        await exportRowsToExcel(`attendance-datewise-${month}${company === "all" ? "" : "-" + company}`, "Date-wise", `Date-wise Attendance — ${format(parseISO(monthStart), "MMMM yyyy")}`, cols, rows);
      } else if (view === "yearly") {
        const cols: ExportColumn[] = [
          { header: "Employee ID", key: "employee_id", width: 12 }, { header: "Name", key: "name", width: 26 },
          { header: "Company", key: "company", width: 10 },
          ...yearMonths.map((m) => ({ header: format(parseISO(m + "-01"), "MMM yy"), key: "m_" + m, width: 8 })),
          { header: "Days Present", key: "days_present", width: 13 }, { header: "Total Hours", key: "total_hours", width: 12 },
          { header: "Missing Out", key: "missing_punch_out", width: 12 },
          { header: "Overtime (h)", key: "ot", width: 12 },
        ];
        const rows = yearlyRows.map((r) => ({
          ...r, name: nameOf(r), total_hours: Math.round(r.total_hours * 100) / 100, ot: Math.round((otFor(r.employee_id)?.hours ?? 0) * 100) / 100,
          ...Object.fromEntries(yearMonths.map((m) => ["m_" + m, r.byMonth[m]?.days_present ?? 0])),
        }));
        const title = `Attendance — ${format(parseISO(yearMonths[0] + "-01"), "MMM yyyy")} to ${format(parseISO(month + "-01"), "MMM yyyy")} (days present)`;
        await exportRowsToExcel(`attendance-1year-to-${month}${company === "all" ? "" : "-" + company}`, "1 Year", title, cols, rows);
      } else {
        const isWeek = view === "weekly";
        const cols: ExportColumn[] = [
          { header: "Employee ID", key: "employee_id", width: 12 }, { header: "Name", key: "name", width: 26 },
          { header: "Company", key: "company", width: 10 },
          { header: "Days Present", key: "days_present", width: 13 }, { header: "Missing Out", key: "missing_punch_out", width: 12 },
          { header: "Total Hours", key: "total_hours", width: 12 }, { header: "Avg Hours/Day", key: "avg_hours_per_day", width: 14 },
          { header: "Earliest In", key: "e_in", width: 12 }, { header: "Latest In", key: "l_in", width: 12 },
          { header: "Overtime (h)", key: "ot", width: 12 }, { header: "OT days", key: "ot_days", width: 9 },
        ];
        const src = isWeek ? weeklyRows : monthlyRows;
        const rows = src.map((r) => ({ ...r, name: nameOf(r), e_in: fmtTime(r.earliest_in), l_in: fmtTime(r.latest_in),
          ot: Math.round((otFor(r.employee_id)?.hours ?? 0) * 100) / 100, ot_days: otFor(r.employee_id)?.days ?? 0 }));
        const title = isWeek
          ? `Weekly Attendance — ${format(parseISO(weekStart), "d MMM")} to ${format(parseISO(weekEnd), "d MMM yyyy")}`
          : `Monthly Attendance — ${format(parseISO(monthStart), "MMMM yyyy")}`;
        await exportRowsToExcel(`attendance-${view}-${isWeek ? weekStart : month}${company === "all" ? "" : "-" + company}`, isWeek ? "Weekly" : "Monthly", title, cols, rows);
      }
      toast.success("Excel downloaded");
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  };

  const shiftWeek = (days: number) => setDate(format(addDays(parseISO(date), days), "yyyy-MM-dd"));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AnimatedPage>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="font-heading text-2xl sm:text-[28px] font-bold text-ink-primary">
          {isAdminView ? "Attendance" : "My Attendance"}
        </h1>
        <div className="flex flex-wrap gap-2">
          {isStrictAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4 mr-1.5" /> Import old punches
            </Button>
          )}
          {isStrictAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowLink(true)}>
              <Link2 className="h-4 w-4 mr-1.5" /> Link Machine IDs
            </Button>
          )}
          {isAdminView && (
            <Button size="sm" variant="outline" onClick={() => setShowRange(true)}>
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export date range
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleExport}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export to Excel
          </Button>
        </div>
      </div>

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <MobileSegments className="w-full" items={tabs} value={view} onChange={(k) => setView(k)} />
        <div className="hidden md:flex gap-1 border-b border-border flex-1 min-w-[260px]">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${view === t.key ? "text-primary" : "text-ink-muted hover:text-ink-secondary"}`}>
              {t.label}
              {view === t.key && <motion.div layoutId="attendance-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>

        {isAdminView && (
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value as Company)}
            className="h-9 flex-1 min-w-0 sm:flex-none rounded-md border border-input bg-background px-3 text-sm text-ink-primary"
            title="Company"
          >
            <option value="all">All companies</option>
            <option value="Trilo">Trilo</option>
            <option value="Mapl">Mapl</option>
          </select>
        )}
        {view === "daily" && isAdminView && (
          <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 flex-1 min-w-0 sm:flex-none sm:w-[160px]" />
        )}
        {view === "weekly" && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => shiftWeek(-7)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-sm text-ink-secondary px-2 whitespace-nowrap">
              {format(parseISO(weekStart), "d MMM")} – {format(parseISO(weekEnd), "d MMM yyyy")}
            </span>
            <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => shiftWeek(7)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}
        {(view === "monthly" || view === "dates" || (view === "daily" && !isAdminView)) && (
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 flex-1 min-w-0 sm:flex-none sm:w-[160px]" />
        )}
        {view === "yearly" && (
          <label className="flex flex-1 items-center gap-2 text-xs text-ink-muted sm:flex-none">
            <span className="whitespace-nowrap">12 months up to</span>
            <Input type="month" value={month} max={format(new Date(), "yyyy-MM")} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 min-w-0 sm:w-[160px]" />
          </label>
        )}
        {isAdminView && view !== "dates" && (
          <div className="relative w-full sm:w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or ID..." className="pl-9 h-9" />
          </div>
        )}
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        {stats.map((s) => (
          <StatCard key={s.title} title={s.title} value={s.value} subtitle={s.sub} icon={s.icon}
            {...(s.warn ? { iconBg: "bg-warning-light", iconColor: "text-warning" } : {})} />
        ))}
      </motion.div>

      {/* Table */}
      <div className="rounded-card bg-card shadow-card overflow-hidden md:overflow-x-auto">
        {activeQ.isLoading ? (
          <p className="p-8 text-center text-sm text-ink-muted">Loading…</p>
        ) : activeQ.error ? (
          <p className="p-8 text-center text-sm text-destructive">{(activeQ.error as Error).message}</p>
        ) : view === "daily" ? (
          dailyRows.length === 0 ? <Empty /> : (
            <>
            {/* Phone: one card per row */}
            <ul className="md:hidden divide-y divide-border">
              {dailyRows.map((r) => (
                <li key={r.employee_id + r.work_date} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-primary truncate">
                        {isAdminView ? nameOf(r) : fmtDate(r.work_date)}
                        {isAdminView && company === "all" && <CompanyBadge c={r.company} />}
                      </p>
                      {isAdminView && <p className="text-xs text-ink-muted">ID {r.employee_id}</p>}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-ink-primary tabular-nums">{fmtHours(r.total_hours)}</span>
                  </div>
                  {r.source === "register" ? (
                    <p className="mt-2"><RegisterBadge status={r.status} /></p>
                  ) : (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-success/10 px-2.5 py-1.5"><span className="text-ink-muted">In </span><span className="font-semibold text-ink-primary tabular-nums">{fmtTime(r.punch_in)}</span></div>
                    <div className="rounded-lg bg-muted px-2.5 py-1.5"><span className="text-ink-muted">Out </span>{r.punch_out ? <span className="font-semibold text-ink-primary tabular-nums">{fmtTime(r.punch_out)}</span> : <Missing />}</div>
                  </div>
                  )}
                  {otOf(r) > 0 && (
                    <p className="mt-1.5 text-xs"><span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Overtime {fmtHours(otOf(r))}</span>
                      <span className="ml-1.5 text-ink-muted">after {otStart(r.punch_in)}</span></p>
                  )}
                </li>
              ))}
            </ul>
            <table className="hidden md:table w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                {isAdminView ? <><Th>ID</Th><Th>Employee</Th></> : <Th>Date</Th>}
                <Th>Punch In</Th><Th>Punch Out</Th><Th>Hours</Th><Th>Overtime</Th>
              </tr></thead>
              <tbody>
                {dailyRows.map((r) => (
                  <tr key={r.employee_id + r.work_date} className="border-b border-border last:border-0 hover:bg-muted/40">
                    {isAdminView
                      ? <><Td className="text-ink-muted">{r.employee_id}</Td><Td className="font-medium text-ink-primary">{nameOf(r)}{company === "all" && <CompanyBadge c={r.company} />}</Td></>
                      : <Td className="font-medium text-ink-primary">{fmtDate(r.work_date)}</Td>}
                    {r.source === "register" ? (
                      <td colSpan={2} className="px-3 sm:px-4 py-3"><RegisterBadge status={r.status} /></td>
                    ) : (<>
                    <Td>{fmtTime(r.punch_in)}</Td>
                    <Td>{r.punch_out ? fmtTime(r.punch_out) : <Missing />}</Td>
                    </>)}
                    <Td>{fmtHours(r.total_hours)}</Td>
                    <Td><OtCell r={r} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )
        ) : view === "dates" ? (
          dateRows.length === 0 ? <Empty /> : (
            <>
            <ul className="md:hidden divide-y divide-border">
              {dateRows.map((r) => (
                <li key={r.work_date} onClick={() => { setDate(r.work_date); setView("daily"); }} className="px-4 py-3 active:bg-muted/40 cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-primary">{fmtDate(r.work_date)}</p>
                    <ChevronRight className="h-4 w-4 text-ink-muted shrink-0" />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/60 py-1.5"><p className="text-sm font-semibold text-ink-primary">{r.employees_present}</p><p className="text-[10px] text-ink-muted">Present</p></div>
                    <div className="rounded-lg bg-muted/60 py-1.5"><p className={`text-sm font-semibold ${r.missing_punch_out > 0 ? "text-warning" : "text-ink-primary"}`}>{r.missing_punch_out}</p><p className="text-[10px] text-ink-muted">Missing out</p></div>
                    <div className="rounded-lg bg-muted/60 py-1.5"><p className="text-sm font-semibold text-ink-primary">{fmtHours(r.avg_hours_per_person)}</p><p className="text-[10px] text-ink-muted">Avg hours</p></div>
                  </div>
                  <p className="mt-2 text-[11px] text-ink-muted">First in {fmtTime(r.first_arrival)} · Last out {fmtTime(r.last_departure)}</p>
                </li>
              ))}
            </ul>
            <table className="hidden md:table w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                <Th>Date</Th><Th>Present</Th><Th>Missing Out</Th><Th>Avg Hours</Th><Th>First In</Th><Th>Last Out</Th><Th>Who</Th>
              </tr></thead>
              <tbody>
                {dateRows.map((r) => (
                  <tr key={r.work_date}
                    onClick={() => { setDate(r.work_date); setView("daily"); }}
                    className="border-b border-border last:border-0 hover:bg-muted/40 cursor-pointer" title="Open this day">
                    <Td className="font-medium text-ink-primary whitespace-nowrap">{fmtDate(r.work_date)}</Td>
                    <Td>{r.employees_present}</Td>
                    <Td>{r.missing_punch_out > 0 ? <span className="text-warning">{r.missing_punch_out}</span> : 0}</Td>
                    <Td>{fmtHours(r.avg_hours_per_person)}</Td>
                    <Td>{fmtTime(r.first_arrival)}</Td>
                    <Td>{fmtTime(r.last_departure)}</Td>
                    <Td className="text-ink-muted max-w-[320px] truncate" title={r.who_was_present}>{r.who_was_present}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )
        ) : view === "yearly" ? (
          yearlyRows.length === 0 ? <Empty /> : (
            <>
            <ul className="md:hidden divide-y divide-border">
              {yearlyRows.map((r) => (
                <li key={r.employee_id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-primary truncate">{nameOf(r)}{company === "all" && <CompanyBadge c={r.company} />}</p>
                      <p className="text-xs text-ink-muted">ID {r.employee_id} · {fmtHours(r.total_hours)}{(otFor(r.employee_id)?.hours ?? 0) > 0 ? ` · OT ${fmtHours(otFor(r.employee_id)!.hours)}` : ""}{r.missing_punch_out > 0 ? ` · ${r.missing_punch_out} missing out` : ""}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-accent-light px-2.5 py-1 text-xs font-semibold text-primary">{r.days_present} days</span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
                    {yearMonths.map((m) => (
                      <button key={m} type="button" onClick={() => { setMonth(m); setView("monthly"); }} className="rounded-md bg-muted/60 py-1">
                        <p className={`text-sm font-semibold ${r.byMonth[m] ? "text-ink-primary" : "text-ink-muted"}`}>{r.byMonth[m]?.days_present ?? "–"}</p>
                        <p className="text-[10px] text-ink-muted">{format(parseISO(m + "-01"), "MMM yy")}</p>
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <table className="hidden md:table w-full table-fixed text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="w-[22%] px-3 py-3 font-medium">Employee</th>
                {yearMonths.map((m) => (
                  <th key={m} className="px-0.5 py-3 text-center font-medium" title={format(parseISO(m + "-01"), "MMMM yyyy")}>
                    <button type="button" onClick={() => { setMonth(m); setView("monthly"); }} className="hover:text-primary">
                      {format(parseISO(m + "-01"), "MMM")}<span className="block text-[9px] normal-case">{format(parseISO(m + "-01"), "yy")}</span>
                    </button>
                  </th>
                ))}
                <th className="w-[7%] px-2 py-3 text-right font-medium">Days</th>
                <th className="w-[9%] px-3 py-3 text-right font-medium">Hours</th>
                <th className="w-[8%] px-3 py-3 text-right font-medium">OT</th>
              </tr></thead>
              <tbody>
                {yearlyRows.map((r) => (
                  <tr key={r.employee_id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2.5">
                      <p className="truncate font-medium text-ink-primary">{nameOf(r)}{company === "all" && <CompanyBadge c={r.company} />}</p>
                      <p className="text-[11px] text-ink-muted">ID {r.employee_id}</p>
                    </td>
                    {yearMonths.map((m) => {
                      const c = r.byMonth[m];
                      return (
                        <td key={m} className="px-0.5 py-2.5 text-center tabular-nums" title={c ? `${c.days_present} days · ${fmtHours(c.total_hours)}${c.missing_punch_out ? ` · ${c.missing_punch_out} missing out` : ""}` : "No punches"}>
                          {c ? <span className="font-medium text-ink-primary">{c.days_present}</span> : <span className="text-ink-muted">–</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2.5 text-right font-semibold text-ink-primary tabular-nums">{r.days_present}</td>
                    <td className="px-3 py-2.5 text-right text-ink-secondary tabular-nums">{fmtHours(r.total_hours)}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-primary tabular-nums">{(otFor(r.employee_id)?.hours ?? 0) > 0 ? fmtHours(otFor(r.employee_id)!.hours) : <span className="text-ink-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )
        ) : (
          (view === "weekly" ? weeklyRows : monthlyRows).length === 0 ? <Empty /> : (
            <>
            <ul className="md:hidden divide-y divide-border">
              {(view === "weekly" ? weeklyRows : monthlyRows).map((r) => (
                <li key={r.employee_id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-primary truncate">{nameOf(r)}{company === "all" && <CompanyBadge c={r.company} />}</p>
                      <p className="text-xs text-ink-muted">ID {r.employee_id}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-accent-light px-2.5 py-1 text-xs font-semibold text-primary">{r.days_present} days</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/60 py-1.5"><p className="text-sm font-semibold text-ink-primary">{fmtHours(r.total_hours)}</p><p className="text-[10px] text-ink-muted">Total</p></div>
                    <div className="rounded-lg bg-muted/60 py-1.5"><p className="text-sm font-semibold text-ink-primary">{fmtHours(r.avg_hours_per_day)}</p><p className="text-[10px] text-ink-muted">Avg / day</p></div>
                    <div className="rounded-lg bg-muted/60 py-1.5"><p className={`text-sm font-semibold ${r.missing_punch_out > 0 ? "text-warning" : "text-ink-primary"}`}>{r.missing_punch_out}</p><p className="text-[10px] text-ink-muted">Missing out</p></div>
                  </div>
                  {(otFor(r.employee_id)?.hours ?? 0) > 0 && (
                    <p className="mt-1.5 text-xs"><span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Overtime {fmtHours(otFor(r.employee_id)!.hours)}</span>
                      <span className="ml-1.5 text-ink-muted">on {otFor(r.employee_id)!.days} day{otFor(r.employee_id)!.days === 1 ? "" : "s"}</span></p>
                  )}
                  <p className="mt-2 text-[11px] text-ink-muted">Earliest in {fmtTime(r.earliest_in)} · Latest in {fmtTime(r.latest_in)}</p>
                </li>
              ))}
            </ul>
            <table className="hidden md:table w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                <Th>ID</Th><Th>Employee</Th><Th>Days Present</Th><Th>Missing Out</Th><Th>Total Hours</Th><Th>Overtime</Th><Th>Avg / Day</Th><Th>Earliest In</Th><Th>Latest In</Th>
              </tr></thead>
              <tbody>
                {(view === "weekly" ? weeklyRows : monthlyRows).map((r) => (
                  <tr key={r.employee_id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <Td className="text-ink-muted">{r.employee_id}</Td>
                    <Td className="font-medium text-ink-primary">{nameOf(r)}{company === "all" && <CompanyBadge c={r.company} />}</Td>
                    <Td>{r.days_present}</Td>
                    <Td>{r.missing_punch_out > 0 ? <span className="text-warning">{r.missing_punch_out}</span> : 0}</Td>
                    <Td>{fmtHours(r.total_hours)}</Td>
                    <Td>{(otFor(r.employee_id)?.hours ?? 0) > 0
                      ? <span><span className="font-semibold text-primary">{fmtHours(otFor(r.employee_id)!.hours)}</span><span className="block text-[11px] text-ink-muted">{otFor(r.employee_id)!.days} day{otFor(r.employee_id)!.days === 1 ? "" : "s"}</span></span>
                      : <span className="text-ink-muted">—</span>}</Td>
                    <Td>{fmtHours(r.avg_hours_per_day)}</Td>
                    <Td>{fmtTime(r.earliest_in)}</Td>
                    <Td>{fmtTime(r.latest_in)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )
        )}
      </div>

      {isStrictAdmin && <LinkMachineIdsDialog open={showLink} onOpenChange={setShowLink} />}
      {isStrictAdmin && showImport && <ImportPunchesDialog onClose={() => setShowImport(false)} />}
      {isAdminView && <RangeExportModal open={showRange} onClose={() => setShowRange(false)} company={company} />}
    </AnimatedPage>
  );
}

// ── Small table helpers ──────────────────────────────────────────────────────
function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 sm:px-4 py-3 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={`px-3 sm:px-4 py-3 text-ink-secondary ${className}`} title={title}>{children}</td>;
}
/** A day taken from the attendance register sheet (no punch times). */
function RegisterBadge({ status }: { status?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="rounded-pill bg-success/10 px-2 py-0.5 font-semibold text-success">{status || "Present"}</span>
      <span className="text-ink-muted">from register · no punch times</span>
    </span>
  );
}
function Missing() {
  return <span className="text-[11px] font-semibold bg-warning-light text-warning px-2 py-0.5 rounded-pill">Not punched</span>;
}
function Empty() {
  return <EmptyState icon={Fingerprint} title="No attendance records" description="No punches were recorded for this period." />;
}

// ── Admin: link each Task Flow user to their ID on the eSSL machine ──────────
function LinkMachineIdsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const profilesQ = useQuery({
    queryKey: ["attendance-link-profiles"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await db.from("profiles").select("id, full_name, role, biometric_code, is_active").order("full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; role: string; biometric_code: string | null; is_active: boolean | null }[];
    },
  });

  // Machine IDs that have punches but no linked user yet
  const unlinkedQ = useQuery({
    queryKey: ["attendance-unlinked"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await db.from("attendance").select("employee_id, employee_name").is("user_id", null).limit(1000);
      if (error) throw error;
      const map = new Map<string, string | null>();
      (data ?? []).forEach((r: any) => map.set(r.employee_id, r.employee_name));
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const changed = Object.entries(edits);
      for (const [id, code] of changed) {
        const value = code.trim() === "" ? null : code.trim();
        const { error } = await db.from("profiles").update({ biometric_code: value }).eq("id", id);
        if (error) {
          const who = profilesQ.data?.find((p) => p.id === id)?.full_name ?? "user";
          throw new Error(error.code === "23505" ? `ID ${value} is already linked to another user (${who})` : error.message);
        }
      }
      return changed.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} user${n === 1 ? "" : "s"} updated`);
      setEdits({});
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("attendance") });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const profiles = (profilesQ.data ?? []).filter((p) => p.is_active !== false);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setEdits({}); onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Machine IDs</DialogTitle>
          <DialogDescription>
            Enter each person's ID from the fingerprint machine (e.g. 006, with the zeros).
            Their punches will then show under their Task Flow name, and they can see their own attendance.
          </DialogDescription>
        </DialogHeader>

        {(unlinkedQ.data?.length ?? 0) > 0 && (
          <div className="rounded-lg bg-warning-light/50 p-3 text-xs text-ink-secondary">
            <p className="font-medium mb-1.5">Machine IDs not linked yet:</p>
            <div className="flex flex-wrap gap-1.5">
              {unlinkedQ.data!.map(([id, name]) => (
                <span key={id} className="rounded-pill bg-card px-2 py-0.5 border border-border">
                  {id}{name ? ` · ${name}` : ""}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto divide-y divide-border">
          {profilesQ.isLoading && <p className="py-6 text-center text-sm text-ink-muted">Loading users…</p>}
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-primary">{p.full_name}</p>
                <p className="text-xs text-ink-muted capitalize">{p.role}</p>
              </div>
              <Input
                className="h-8 w-[110px]"
                placeholder="Machine ID"
                value={edits[p.id] ?? p.biometric_code ?? ""}
                onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(edits).length === 0}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Date-range export (admins): every day's punch in/out for each person ──────
function RangeExportModal({ open, onClose, company }: { open: boolean; onClose: () => void; company: Company }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [from, setFrom] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [to, setTo] = useState(today);
  const [co, setCo] = useState<Company>(company);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!from || !to || from > to) { toast.error("Pick a valid From and To date"); return; }
    setBusy(true);
    try {
      const all: AttendanceRow[] = [];
      for (let off = 0; ; off += 1000) {
        let q = (supabase as any).from("attendance").select("*")
          .gte("work_date", from).lte("work_date", to)
          .order("work_date").order("employee_id").range(off, off + 999);
        if (co !== "all") q = q.eq("company", co);
        const { data, error } = await q;
        if (error) throw error;
        all.push(...((data ?? []) as AttendanceRow[]));
        if (!data || data.length < 1000) break;
      }
      if (all.length === 0) { toast.error("No attendance in that range"); return; }
      const rows = all
        .map((r) => ({
          ...r,
          name: nameOf(r),
          date: format(parseISO(r.work_date), "dd-MM-yyyy"),
          day: format(parseISO(r.work_date), "EEE"),
          in: fmtTime(r.punch_in),
          out: fmtTime(r.punch_out),
        }))
        .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.name.localeCompare(b.name));
      const cols: ExportColumn[] = [
        { header: "Date", key: "date", width: 13 }, { header: "Day", key: "day", width: 7 },
        { header: "Employee ID", key: "employee_id", width: 12 }, { header: "Name", key: "name", width: 26 },
        { header: "Company", key: "company", width: 10 },
        { header: "Punch In", key: "in", width: 12 }, { header: "Punch Out", key: "out", width: 12 },
        { header: "Hours", key: "total_hours", width: 10 },
      ];
      const title = `Attendance — ${format(parseISO(from), "d MMM")} to ${format(parseISO(to), "d MMM yyyy")}${co === "all" ? "" : " (" + co + ")"}`;
      await exportRowsToExcel(`attendance-${from}-to-${to}${co === "all" ? "" : "-" + co}`, "Attendance", title, cols, rows);
      toast.success("Excel downloaded");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export date range</DialogTitle>
          <DialogDescription>Every day's punch in / out for each employee.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-secondary">From
            <Input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="h-9 mt-1" />
          </label>
          <label className="text-sm text-ink-secondary">To
            <Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="h-9 mt-1" />
          </label>
          <label className="text-sm text-ink-secondary col-span-2">Company
            <select value={co} onChange={(e) => setCo(e.target.value as Company)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-ink-primary">
              <option value="all">All companies</option>
              <option value="Trilo">Trilo</option>
              <option value="Mapl">Mapl</option>
            </select>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy}>{busy ? "Exporting…" : "Download Excel"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Admin: load past punches from the eSSL machine (USB download / software export) ──
type Punch = { c: string; t: string };   // machine ID, "YYYY-MM-DD HH:MM:SS" (India time)

const pad = (n: number | string) => String(n).padStart(2, "0");
/** Finds a date+time in one text cell / line. Accepts 2025-11-03 09:01:22, 03/11/2025 09:01, 03-11-2025 9:01 AM … */
function findDateTime(text: string): string | null {
  let m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];                     // India: day first
  }
  let h = +m[4];
  const ap = (m[7] ?? "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23) return null;
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${m[5]}:${pad(m[6] ?? 0)}`;
}
/** Header row ("Emp Code", "User ID", "Enroll No" …) → which column holds the machine ID. */
function idColumnOf(cells: string[]): number | null {
  const i = cells.findIndex((c) => /(emp|employee|user|enrol+|ac|badge|card)[\s._-]*(id|no|code|number)|^(id|code|e\.?code)$/i.test(String(c ?? "").trim()));
  return i >= 0 ? i : null;
}
/** One row of cells → punch. ID = first short number-like cell; date+time from one cell or a date cell + a time cell. */
function rowToPunch(cells: string[], idCol: number | null): Punch | null {
  const clean = cells.map((c) => String(c ?? "").replace(/^"|"$/g, "").trim());
  const t = findDateTime(clean.join(" "));
  if (!t) return null;
  const isId = (c: string) => /^[A-Za-z]{0,3}\d{1,9}$/.test(c);
  const code = idCol != null && isId(clean[idCol] ?? "") ? clean[idCol] : clean.find(isId);
  if (!code) return null;
  return { c: code, t };   // keep the ID exactly as the machine has it (005 ≠ 5)
}
async function parsePunchFile(file: File): Promise<Punch[]> {
  const out: Punch[] = [];
  if (/\.xlsx$/i.test(file.name)) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    wb.worksheets.forEach((ws) => { let idCol: number | null = null; ws.eachRow((row) => {
      const cells = (row.values as any[]).slice(1).map((v) => {
        if (v instanceof Date) {   // Excel dates are stored as UTC clock values
          return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
        }
        return v && typeof v === "object" && "text" in v ? String(v.text) : String(v ?? "");
      });
      // a date-only cell followed by a time cell
      if (idCol == null && !findDateTime(cells.join(" "))) { idCol = idColumnOf(cells); return; }
      const p = rowToPunch(cells.map((c, i) => /^\d{4}-\d{2}-\d{2} 00:00:00$/.test(c) && /\d{1,2}:\d{2}/.test(cells[i + 1] ?? "") ? c.slice(0, 10) : c), idCol);
      if (p) out.push(p);
    }); });
  } else {
    const text = await file.text();
    let idCol: number | null = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cells = line.trim().split(/\t|,|;|\s{2,}/);
      if (idCol == null && !findDateTime(line)) { idCol = idColumnOf(cells); continue; }
      const p = rowToPunch(cells, idCol);
      if (p) out.push(p);
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => { const k = p.c + "|" + p.t; if (seen.has(k)) return false; seen.add(k); return true; });
}

function ImportPunchesDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFile(f); setPunches(null);
    try { setPunches(await parsePunchFile(f)); }
    catch (e: any) { toast.error("Could not read the file: " + (e?.message ?? "")); }
  };
  const range = punches?.length ? [punches.reduce((a, p) => (p.t < a ? p.t : a), punches[0].t), punches.reduce((a, p) => (p.t > a ? p.t : a), punches[0].t)] : null;
  const ids = punches ? new Set(punches.map((p) => p.c)).size : 0;

  const run = async () => {
    if (!punches?.length) return;
    setBusy(true); setDone(0);
    let added = 0;
    try {
      for (let i = 0; i < punches.length; i += 1000) {
        const { data, error } = await db.rpc("import_punches", { p_rows: punches.slice(i, i + 1000) });
        if (error) throw error;
        added += Number(data ?? 0);
        setDone(Math.min(i + 1000, punches.length));
      }
      toast.success(`Imported ${added} new punches (${punches.length - added} were already there)`);
      qc.invalidateQueries();
      onClose();
    } catch (e: any) {
      const m = e?.message ?? "";
      toast.error(/import_punches|does not exist|schema cache/i.test(m) ? "Run TRILO_attendance_history.sql first." : m);
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import old punches</DialogTitle>
          <DialogDescription>
            Load past attendance (up to a year or more) from the eSSL machine — the USB download (attlog .dat/.txt) or an
            export from the eSSL software (.csv / .xlsx). Each line needs the machine ID and the punch date &amp; time.
            Punches already in Task Flow are skipped.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-3 py-6 text-sm text-ink-secondary hover:bg-muted/40">
          <Upload className="h-5 w-5 text-ink-muted" />
          {file ? file.name : "Choose or drop the file"}
          <input type="file" accept=".dat,.txt,.csv,.xlsx" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {punches && (
          punches.length === 0
            ? <p className="text-sm text-destructive">No punches found in this file. Each line needs a machine ID and a date &amp; time.</p>
            : <div className="rounded-md bg-muted/50 p-3 text-sm">
                <p><b>{punches.length.toLocaleString("en-IN")}</b> punches · <b>{ids}</b> machine IDs</p>
                {range && <p className="text-xs text-ink-muted">From {range[0].slice(0, 10)} to {range[1].slice(0, 10)}</p>}
                <p className="mt-1 text-xs text-ink-muted">e.g. ID {punches[0].c} at {punches[0].t}</p>
              </div>
        )}
        {busy && <p className="text-xs text-ink-muted">Importing… {done.toLocaleString("en-IN")} / {punches?.length.toLocaleString("en-IN")}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy || !punches?.length}>{busy ? "Importing…" : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
