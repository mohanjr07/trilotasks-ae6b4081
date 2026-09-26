// ─────────────────────────────────────────────────────────────────────────────
//  AttendancePage.tsx
//  Biometric (eSSL) attendance: Daily · Date-wise · Weekly · Monthly.
//  Data comes from the `attendance` table + summary views (see migration
//  20260926000001_add_attendance.sql). Admins/managers see everyone;
//  employees see only their own rows (enforced by RLS).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek, addDays, parseISO } from "date-fns";
import {
  Search, Users, CheckCircle2, AlertTriangle, Clock, FileSpreadsheet, Link2, Fingerprint,
  ChevronLeft, ChevronRight,
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

// New tables/views aren't in the generated Supabase types yet.
const db = supabase as any;

type ViewKey = "daily" | "dates" | "weekly" | "monthly";

type AttendanceRow = {
  employee_id: string; user_id: string | null; employee_name: string | null; work_date: string;
  punch_in: string | null; punch_out: string | null; total_hours: number | null; punch_count: number;
};
type DailySummaryRow = {
  work_date: string; day: string; employees_present: number; missing_punch_out: number;
  total_hours: number; avg_hours_per_person: number | null; first_arrival: string | null;
  last_arrival: string | null; last_departure: string | null; who_was_present: string;
};
type PeriodRow = {
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
function fmtHours(h: number | null | undefined) {
  if (h === null || h === undefined) return "—";
  const n = Number(h);
  const hrs = Math.floor(n);
  const mins = Math.round((n - hrs) * 60);
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`;
}
const fmtDate = (d: string) => format(parseISO(d), "EEE, d MMM yyyy");
const nameOf = (r: { employee_name: string | null; employee_id: string }) => r.employee_name || `ID ${r.employee_id}`;

// ─────────────────────────────────────────────────────────────────────────────
export default function AttendancePage() {
  const { user, profile } = useAuth();
  const isAdminView = ["admin", "manager", "super_admin"].includes(profile?.role ?? "");
  const isStrictAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const today = format(new Date(), "yyyy-MM-dd");
  const [view, setView] = useState<ViewKey>("daily");
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [search, setSearch] = useState("");
  const [showLink, setShowLink] = useState(false);

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
      ]
    : [
        { key: "daily", label: "Daily" },
        { key: "weekly", label: "Weekly" },
        { key: "monthly", label: "Monthly" },
      ];

  // ── Data ───────────────────────────────────────────────────────────────────
  // Admin daily = everyone on one date. Employee daily = own rows for the month.
  const dailyQ = useQuery({
    queryKey: ["attendance-daily", isAdminView, date, month, user?.id],
    enabled: view === "daily" && !!user,
    queryFn: async () => {
      let q = db.from("attendance").select("*");
      q = isAdminView
        ? q.eq("work_date", date).order("employee_id")
        : q.eq("user_id", user!.id).gte("work_date", monthStart).lte("work_date", monthEnd).order("work_date", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AttendanceRow[];
    },
  });

  const datesQ = useQuery({
    queryKey: ["attendance-dates", month],
    enabled: view === "dates" && isAdminView,
    queryFn: async () => {
      const { data, error } = await db.from("daily_summary").select("*")
        .gte("work_date", monthStart).lte("work_date", monthEnd).order("work_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DailySummaryRow[];
    },
  });

  const weeklyQ = useQuery({
    queryKey: ["attendance-weekly", weekStart],
    enabled: view === "weekly",
    queryFn: async () => {
      const { data, error } = await db.from("weekly_attendance").select("*").eq("week_start", weekStart).order("employee_id");
      if (error) throw error;
      return (data ?? []) as PeriodRow[];
    },
  });

  const monthlyQ = useQuery({
    queryKey: ["attendance-monthly", month],
    enabled: view === "monthly",
    queryFn: async () => {
      const { data, error } = await db.from("monthly_attendance").select("*").eq("month", month).order("employee_id");
      if (error) throw error;
      return (data ?? []) as PeriodRow[];
    },
  });

  const activeQ = { daily: dailyQ, dates: datesQ, weekly: weeklyQ, monthly: monthlyQ }[view];

  const matches = (r: { employee_id?: string; employee_name?: string | null }) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (r.employee_name ?? "").toLowerCase().includes(s) || (r.employee_id ?? "").toLowerCase().includes(s);
  };

  const dailyRows = useMemo(() => (dailyQ.data ?? []).filter(matches), [dailyQ.data, search]);
  const weeklyRows = useMemo(() => (weeklyQ.data ?? []).filter(matches), [weeklyQ.data, search]);
  const monthlyRows = useMemo(() => (monthlyQ.data ?? []).filter(matches), [monthlyQ.data, search]);
  const dateRows = datesQ.data ?? [];

  // ── Stat cards ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const rows =
      view === "daily" ? dailyRows :
      view === "weekly" ? weeklyRows :
      view === "monthly" ? monthlyRows : [];
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
      const complete = r.filter((x) => x.punch_out).length;
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
  }, [view, dailyRows, weeklyRows, monthlyRows, dateRows, isAdminView]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      if (view === "daily") {
        const cols: ExportColumn[] = [
          ...(isAdminView ? [{ header: "Employee ID", key: "employee_id", width: 12 }, { header: "Name", key: "name", width: 26 }] : []),
          { header: "Date", key: "work_date", width: 14 },
          { header: "Punch In", key: "in", width: 12 },
          { header: "Punch Out", key: "out", width: 12 },
          { header: "Hours", key: "total_hours", width: 10 },
        ];
        const rows = dailyRows.map((r) => ({ ...r, name: nameOf(r), in: fmtTime(r.punch_in), out: fmtTime(r.punch_out) }));
        const label = isAdminView ? date : month;
        await exportRowsToExcel(`attendance-daily-${label}`, "Daily", `Attendance — ${isAdminView ? fmtDate(date) : format(parseISO(monthStart), "MMMM yyyy")}`, cols, rows);
      } else if (view === "dates") {
        const cols: ExportColumn[] = [
          { header: "Date", key: "work_date", width: 14 }, { header: "Day", key: "day", width: 8 },
          { header: "Present", key: "employees_present", width: 10 }, { header: "Missing Out", key: "missing_punch_out", width: 12 },
          { header: "Avg Hours", key: "avg_hours_per_person", width: 11 }, { header: "First In", key: "first", width: 11 },
          { header: "Last Out", key: "last", width: 11 }, { header: "Who was present", key: "who_was_present", width: 60 },
        ];
        const rows = dateRows.map((r) => ({ ...r, first: fmtTime(r.first_arrival), last: fmtTime(r.last_departure) }));
        await exportRowsToExcel(`attendance-datewise-${month}`, "Date-wise", `Date-wise Attendance — ${format(parseISO(monthStart), "MMMM yyyy")}`, cols, rows);
      } else {
        const isWeek = view === "weekly";
        const cols: ExportColumn[] = [
          { header: "Employee ID", key: "employee_id", width: 12 }, { header: "Name", key: "name", width: 26 },
          { header: "Days Present", key: "days_present", width: 13 }, { header: "Missing Out", key: "missing_punch_out", width: 12 },
          { header: "Total Hours", key: "total_hours", width: 12 }, { header: "Avg Hours/Day", key: "avg_hours_per_day", width: 14 },
          { header: "Earliest In", key: "e_in", width: 12 }, { header: "Latest In", key: "l_in", width: 12 },
        ];
        const src = isWeek ? weeklyRows : monthlyRows;
        const rows = src.map((r) => ({ ...r, name: nameOf(r), e_in: fmtTime(r.earliest_in), l_in: fmtTime(r.latest_in) }));
        const title = isWeek
          ? `Weekly Attendance — ${format(parseISO(weekStart), "d MMM")} to ${format(parseISO(weekEnd), "d MMM yyyy")}`
          : `Monthly Attendance — ${format(parseISO(monthStart), "MMMM yyyy")}`;
        await exportRowsToExcel(`attendance-${view}-${isWeek ? weekStart : month}`, isWeek ? "Weekly" : "Monthly", title, cols, rows);
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
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">
          {isAdminView ? "Attendance" : "My Attendance"}
        </h1>
        <div className="flex gap-2">
          {isStrictAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowLink(true)}>
              <Link2 className="h-4 w-4 mr-1.5" /> Link Machine IDs
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleExport}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export to Excel
          </Button>
        </div>
      </div>

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex gap-1 border-b border-border flex-1 min-w-[260px]">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${view === t.key ? "text-primary" : "text-ink-muted hover:text-ink-secondary"}`}>
              {t.label}
              {view === t.key && <motion.div layoutId="attendance-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>

        {view === "daily" && isAdminView && (
          <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 w-[160px]" />
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
          <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-[160px]" />
        )}
        {isAdminView && view !== "dates" && (
          <div className="relative w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or ID..." className="pl-9 h-9" />
          </div>
        )}
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <StatCard key={s.title} title={s.title} value={s.value} subtitle={s.sub} icon={s.icon}
            {...(s.warn ? { iconBg: "bg-warning-light", iconColor: "text-warning" } : {})} />
        ))}
      </motion.div>

      {/* Table */}
      <div className="rounded-card bg-card shadow-card overflow-x-auto">
        {activeQ.isLoading ? (
          <p className="p-8 text-center text-sm text-ink-muted">Loading…</p>
        ) : activeQ.error ? (
          <p className="p-8 text-center text-sm text-destructive">{(activeQ.error as Error).message}</p>
        ) : view === "daily" ? (
          dailyRows.length === 0 ? <Empty /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                {isAdminView ? <><Th>ID</Th><Th>Employee</Th></> : <Th>Date</Th>}
                <Th>Punch In</Th><Th>Punch Out</Th><Th>Hours</Th>
              </tr></thead>
              <tbody>
                {dailyRows.map((r) => (
                  <tr key={r.employee_id + r.work_date} className="border-b border-border last:border-0 hover:bg-muted/40">
                    {isAdminView
                      ? <><Td className="text-ink-muted">{r.employee_id}</Td><Td className="font-medium text-ink-primary">{nameOf(r)}</Td></>
                      : <Td className="font-medium text-ink-primary">{fmtDate(r.work_date)}</Td>}
                    <Td>{fmtTime(r.punch_in)}</Td>
                    <Td>{r.punch_out ? fmtTime(r.punch_out) : <Missing />}</Td>
                    <Td>{fmtHours(r.total_hours)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : view === "dates" ? (
          dateRows.length === 0 ? <Empty /> : (
            <table className="w-full text-sm">
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
          )
        ) : (
          (view === "weekly" ? weeklyRows : monthlyRows).length === 0 ? <Empty /> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                <Th>ID</Th><Th>Employee</Th><Th>Days Present</Th><Th>Missing Out</Th><Th>Total Hours</Th><Th>Avg / Day</Th><Th>Earliest In</Th><Th>Latest In</Th>
              </tr></thead>
              <tbody>
                {(view === "weekly" ? weeklyRows : monthlyRows).map((r) => (
                  <tr key={r.employee_id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <Td className="text-ink-muted">{r.employee_id}</Td>
                    <Td className="font-medium text-ink-primary">{nameOf(r)}</Td>
                    <Td>{r.days_present}</Td>
                    <Td>{r.missing_punch_out > 0 ? <span className="text-warning">{r.missing_punch_out}</span> : 0}</Td>
                    <Td>{fmtHours(r.total_hours)}</Td>
                    <Td>{fmtHours(r.avg_hours_per_day)}</Td>
                    <Td>{fmtTime(r.earliest_in)}</Td>
                    <Td>{fmtTime(r.latest_in)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      {isStrictAdmin && <LinkMachineIdsDialog open={showLink} onOpenChange={setShowLink} />}
    </AnimatedPage>
  );
}

// ── Small table helpers ──────────────────────────────────────────────────────
function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={`px-4 py-3 text-ink-secondary ${className}`} title={title}>{children}</td>;
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
