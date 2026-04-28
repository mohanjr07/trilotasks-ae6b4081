import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  format, differenceInYears, parseISO, eachDayOfInterval,
  startOfMonth, endOfMonth, isWeekend, isAfter, isBefore, min, max,
} from "date-fns";
import {
  Search, X, Mail, Phone, Briefcase, Building2, Calendar as CalendarIcon,
  Cake, Shield, User as UserIcon, Users as UsersIcon, Package,
  CheckCircle2, XCircle, Clock as ClockIcon, Pencil, Save,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "manager" | "employee" | "intern" | "super_admin";
  department: string | null;
  position: string | null;
  avatar_url: string | null;
  phone: string | null;
  date_of_birth: string | null;
  joined_at: string | null;
  is_active: boolean;
  created_at: string;
};

type AssetRow = {
  id: string;
  asset_name: string;
  asset_type: string;
  asset_category: "IT" | "Machines" | "Softwares";
  serial_number: string | null;
  status: string;
  holder_id: string | null;
  holder_name: string | null;
  assigned_at: string | null;
};

type LeaveRow = {
  id: string;
  employee_id: string;
  type: "leave" | "permission";
  leave_category: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  is_half_day?: boolean | null;
  reverted_at?: string | null;
  created_at: string;
};

// ---- Attendance helpers --------------------------------------------------
// Working days = Mon–Fri in the current month, capped at today.
function workingDaysSoFar(monthStart: Date, monthEnd: Date): Date[] {
  const today = new Date();
  const cap = isBefore(today, monthEnd) ? today : monthEnd;
  if (isBefore(cap, monthStart)) return [];
  return eachDayOfInterval({ start: monthStart, end: cap }).filter(d => !isWeekend(d));
}

// Effective weekday-leave days for a single approved (non-reverted) leave row,
// counted within [monthStart, cappedEnd].
function leaveDaysInMonth(l: LeaveRow, monthStart: Date, cappedEnd: Date): number {
  if (l.status !== "approved" || l.reverted_at) return 0;
  if (l.type === "permission") {
    // Permissions are partial-day — count as 0.25 day if the date falls in window.
    const d = parseISO(l.start_date);
    if (isBefore(d, monthStart) || isAfter(d, cappedEnd) || isWeekend(d)) return 0;
    return 0.25;
  }
  // type === "leave"
  const start = parseISO(l.start_date);
  const end = parseISO(l.end_date ?? l.start_date);
  const s = max([start, monthStart]);
  const e = min([end, cappedEnd]);
  if (isAfter(s, e)) return 0;
  const weekdays = eachDayOfInterval({ start: s, end: e }).filter(d => !isWeekend(d)).length;
  if (weekdays === 0) return 0;
  if (l.is_half_day) return Math.min(0.5, weekdays); // half-day flag → 0.5 regardless of span
  return weekdays;
}

function attendancePctForUser(userId: string, leaves: LeaveRow[]): {
  pct: number;
  workingDays: number;
  leaveDays: number;
} {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const days = workingDaysSoFar(monthStart, monthEnd);
  const workingDays = days.length;
  if (workingDays === 0) return { pct: 100, workingDays: 0, leaveDays: 0 };

  const cappedEnd = days[days.length - 1];
  const userLeaves = leaves.filter(l => l.employee_id === userId);
  const leaveDays = userLeaves.reduce(
    (sum, l) => sum + leaveDaysInMonth(l, monthStart, cappedEnd),
    0
  );
  const present = Math.max(0, workingDays - leaveDays);
  const pct = Math.round((present / workingDays) * 1000) / 10; // 1 decimal
  return { pct, workingDays, leaveDays };
}

function attendanceColor(pct: number) {
  if (pct >= 95) return "text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400";
  if (pct >= 85) return "text-blue-700 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400";
  if (pct >= 70) return "text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400";
  return "text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400";
}
// --------------------------------------------------------------------------

const roleColor = (role: string) => {
  switch (role) {
    case "super_admin": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    case "admin":       return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
    case "manager":     return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "employee":    return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "intern":      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    default:            return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
  }
};

const leaveStatusConfig = {
  approved: { label: "Approved", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2 },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",         icon: XCircle },
  pending:  { label: "Pending",  color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: ClockIcon },
};

function formatDate(d?: string | null) {
  if (!d) return "—";
  try { return format(parseISO(d), "MMM d, yyyy"); } catch { return d; }
}

function ageFromDob(dob?: string | null) {
  if (!dob) return null;
  try { return differenceInYears(new Date(), parseISO(dob)); } catch { return null; }
}

export default function PeoplePage() {
  const { profile: me } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = me?.role === "admin";

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selected, setSelected] = useState<Profile | null>(null);

  // Edit-DOB state (admin only, in detail panel)
  const [editingDob, setEditingDob] = useState(false);
  const [dobDraft, setDobDraft] = useState<string>("");

  // Edit-Joined state (admin only)
  const [editingJoined, setEditingJoined] = useState(false);
  const [joinedDraft, setJoinedDraft] = useState<string>("");

  const { data: people = [], isLoading } = useQuery({
    queryKey: ["people-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  // All approved, non-reverted leaves overlapping this month — used to show
  // attendance % on every person card without one-query-per-user.
  const { data: monthLeaves = [] } = useQuery({
    queryKey: ["people-month-leaves"],
    queryFn: async () => {
      const monthStart = startOfMonth(new Date());
      const monthEnd = endOfMonth(new Date());
      const startStr = format(monthStart, "yyyy-MM-dd");
      const endStr = format(monthEnd, "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("status", "approved")
        .is("reverted_at", null)
        .lte("start_date", endStr)
        // end_date may be null for single-day rows, so include rows where
        // end_date is null OR end_date >= startStr
        .or(`end_date.gte.${startStr},end_date.is.null`);
      if (error) throw error;
      return (data ?? []) as LeaveRow[];
    },
  });

  const attendanceByUser = useMemo(() => {
    const map: Record<string, { pct: number; workingDays: number; leaveDays: number }> = {};
    people.forEach(p => { map[p.id] = attendancePctForUser(p.id, monthLeaves); });
    return map;
  }, [people, monthLeaves]);

  const orgAttendance = useMemo(() => {
    const vals = Object.values(attendanceByUser);
    if (vals.length === 0) return 0;
    const sum = vals.reduce((s, v) => s + v.pct, 0);
    return Math.round((sum / vals.length) * 10) / 10;
  }, [attendanceByUser]);

  const { data: heldAssets = [] } = useQuery({
    queryKey: ["people-held-assets", selected?.id],
    queryFn: async () => {
      if (!selected) return [] as AssetRow[];
      // Match by holder_id when present, fall back to holder_name
      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .or(`holder_id.eq.${selected.id},holder_name.eq.${selected.full_name}`);
      if (error) throw error;
      return (data ?? []) as AssetRow[];
    },
    enabled: !!selected,
  });

  const { data: leaves = [] } = useQuery({
    queryKey: ["people-leaves", selected?.id],
    queryFn: async () => {
      if (!selected) return [] as LeaveRow[];
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("employee_id", selected.id)
        .order("start_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as LeaveRow[];
    },
    enabled: !!selected,
  });

  const updateDobMutation = useMutation({
    mutationFn: async ({ id, dob }: { id: string; dob: string | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ date_of_birth: dob })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["people-profiles"] });
      if (selected && selected.id === vars.id) {
        setSelected({ ...selected, date_of_birth: vars.dob });
      }
      toast.success("Date of birth updated");
      setEditingDob(false);
    },
    onError: (e: any) => toast.error("Failed: " + (e?.message ?? "Unknown error")),
  });

  const updateJoinedMutation = useMutation({
    mutationFn: async ({ id, joined }: { id: string; joined: string | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ joined_at: joined })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["people-profiles"] });
      if (selected && selected.id === vars.id) {
        setSelected({ ...selected, joined_at: vars.joined });
      }
      toast.success("Joined date updated");
      setEditingJoined(false);
    },
    onError: (e: any) => toast.error("Failed: " + (e?.message ?? "Unknown error")),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return people.filter(p => {
      if (q && !p.full_name.toLowerCase().includes(q) && !p.email.toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && p.role !== roleFilter) return false;
      return true;
    });
  }, [people, search, roleFilter]);

  const stats = {
    total: people.length,
    admins: people.filter(p => p.role === "admin" || p.role === "super_admin").length,
    employees: people.filter(p => p.role === "employee").length,
    interns: people.filter(p => p.role === "intern").length,
  };

  const leaveCounts = useMemo(() => {
    const approved = leaves.filter(l => l.status === "approved").length;
    const pending  = leaves.filter(l => l.status === "pending").length;
    const rejected = leaves.filter(l => l.status === "rejected").length;
    return { approved, pending, rejected, total: leaves.length };
  }, [leaves]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-ink-primary">People</h2>
          <p className="text-sm text-ink-muted mt-0.5">Browse profiles, assets, and attendance</p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total People",   value: stats.total,                 icon: UsersIcon,    bg: "bg-primary/10",                       color: "text-primary" },
          { label: "Admins",         value: stats.admins,                icon: Shield,       bg: "bg-purple-100 dark:bg-purple-900/30", color: "text-purple-600" },
          { label: "Employees",      value: stats.employees,             icon: UserIcon,     bg: "bg-green-100 dark:bg-green-900/30",   color: "text-green-600" },
          { label: "Avg Attendance", value: `${orgAttendance}%`,         icon: CheckCircle2, bg: "bg-blue-100 dark:bg-blue-900/30",     color: "text-blue-600" },
        ].map(({ label, value, icon: Icon, bg, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-ink-secondary">{label}</p>
                <p className="mt-1 text-3xl font-bold text-ink-primary">{value}</p>
              </div>
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", bg)}>
                <Icon className={cn("h-5 w-5", color)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="intern">Intern</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* People grid */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-card flex items-center justify-center py-20 text-ink-muted text-sm">
          Loading people…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
            <UsersIcon className="h-8 w-8 text-ink-muted" />
          </div>
          <h3 className="text-lg font-semibold text-ink-primary mb-1">No people found</h3>
          <p className="text-sm text-ink-muted">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((p) => {
            const att = attendanceByUser[p.id];
            return (
              <button
                key={p.id}
                onClick={() => { setSelected(p); setEditingDob(false); setDobDraft(p.date_of_birth ?? ""); }}
                className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start gap-3">
                  <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-primary truncate group-hover:text-primary transition-colors">{p.full_name}</p>
                    <p className="text-xs text-ink-muted truncate">{p.email}</p>
                  </div>
                  {att && (
                    <span
                      className={cn("shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", attendanceColor(att.pct))}
                      title={`This month: ${att.workingDays - att.leaveDays}/${att.workingDays} working days`}
                    >
                      {att.pct}%
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", roleColor(p.role))}>
                    {p.role.replace("_", " ")}
                  </span>
                  {!p.is_active && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      Inactive
                    </span>
                  )}
                  {p.department && (
                    <span className="text-[11px] text-ink-muted truncate">· {p.department}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Drawer */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => { setSelected(null); setEditingDob(false); setEditingJoined(false); }}
            />
            <motion.div
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 280, damping: 30 }}
              className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] bg-card border-l border-border z-50 flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h3 className="text-lg font-semibold text-ink-primary">Profile</h3>
                <button
                  onClick={() => { setSelected(null); setEditingDob(false); setEditingJoined(false); }}
                  className="text-ink-muted hover:text-ink-primary"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto">
                {/* Hero */}
                <div className="px-5 py-6 border-b border-border flex items-center gap-4">
                  <UserAvatar name={selected.full_name} avatarUrl={selected.avatar_url} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xl font-semibold text-ink-primary truncate">{selected.full_name}</h4>
                    <p className="text-sm text-ink-muted truncate">{selected.email}</p>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", roleColor(selected.role))}>
                        {selected.role.replace("_", " ")}
                      </span>
                      {selected.is_active
                        ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Active</span>
                        : <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">Inactive</span>
                      }
                    </div>
                  </div>
                </div>

                {/* Info rows */}
                <div className="px-5 py-4 space-y-3 border-b border-border">
                  <InfoRow icon={Mail}       label="Email"      value={selected.email} />
                  <InfoRow icon={Phone}      label="Phone"      value={selected.phone || "—"} />
                  <InfoRow icon={Briefcase}  label="Position"   value={selected.position || "—"} />
                  <InfoRow icon={Building2}  label="Department" value={selected.department || "—"} />

                  {/* DOB row with admin-edit */}
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-ink-muted shrink-0">
                      <Cake className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-ink-muted">Date of Birth</p>
                      {editingDob && isAdmin ? (
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            type="date"
                            value={dobDraft}
                            onChange={(e) => setDobDraft(e.target.value)}
                            className="h-8 text-sm"
                          />
                          <Button
                            size="sm"
                            className="h-8 px-3"
                            onClick={() => updateDobMutation.mutate({ id: selected.id, dob: dobDraft || null })}
                            disabled={updateDobMutation.isPending}
                          >
                            <Save className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3"
                            onClick={() => { setEditingDob(false); setDobDraft(selected.date_of_birth ?? ""); }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-ink-primary">
                            {selected.date_of_birth ? formatDate(selected.date_of_birth) : "Not set"}
                            {ageFromDob(selected.date_of_birth) !== null && (
                              <span className="text-ink-muted ml-1">· {ageFromDob(selected.date_of_birth)} yrs</span>
                            )}
                          </p>
                          {isAdmin && (
                            <button
                              onClick={() => { setEditingDob(true); setDobDraft(selected.date_of_birth ?? ""); }}
                              className="text-ink-muted hover:text-ink-primary p-1 -my-1 rounded"
                              title="Edit DOB"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Joined row — editable for admins, falls back to created_at when joined_at is null */}
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-ink-muted shrink-0">
                      <CalendarIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] uppercase tracking-wide text-ink-muted">Joined</p>
                      {editingJoined && isAdmin ? (
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            type="date"
                            value={joinedDraft}
                            onChange={(e) => setJoinedDraft(e.target.value)}
                            className="h-8 text-sm"
                          />
                          <Button
                            size="sm"
                            className="h-8 px-3"
                            onClick={() => updateJoinedMutation.mutate({ id: selected.id, joined: joinedDraft || null })}
                            disabled={updateJoinedMutation.isPending}
                          >
                            <Save className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3"
                            onClick={() => {
                              setEditingJoined(false);
                              setJoinedDraft(selected.joined_at ?? (selected.created_at ? selected.created_at.slice(0, 10) : ""));
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-ink-primary">
                            {formatDate(selected.joined_at ?? selected.created_at)}
                            {!selected.joined_at && (
                              <span className="text-ink-muted ml-1 text-xs">(auto)</span>
                            )}
                          </p>
                          {isAdmin && (
                            <button
                              onClick={() => {
                                setEditingJoined(true);
                                setJoinedDraft(selected.joined_at ?? (selected.created_at ? selected.created_at.slice(0, 10) : ""));
                              }}
                              className="text-ink-muted hover:text-ink-primary p-1 -my-1 rounded"
                              title="Edit joined date"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Assets held */}
                <div className="px-5 py-4 border-b border-border">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
                      <Package className="h-4 w-4" /> Assets Held
                    </h5>
                    <span className="text-xs text-ink-muted">{heldAssets.length}</span>
                  </div>
                  {heldAssets.length === 0 ? (
                    <p className="text-sm text-ink-muted">No assets currently assigned.</p>
                  ) : (
                    <ul className="space-y-2">
                      {heldAssets.map((a) => (
                        <li key={a.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink-primary truncate">{a.asset_name}</p>
                            <p className="text-xs text-ink-muted truncate">
                              {a.asset_type}{a.serial_number ? ` · ${a.serial_number}` : ""}
                            </p>
                          </div>
                          <span className="text-[11px] rounded-full px-2 py-0.5 bg-primary/10 text-primary capitalize shrink-0 ml-2">
                            {a.asset_category}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Attendance / Leave */}
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-semibold text-ink-primary flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4" /> Attendance Record
                    </h5>
                    <span className="text-[11px] text-ink-muted">{format(new Date(), "MMMM yyyy")}</span>
                  </div>

                  {/* Attendance % progress block */}
                  {(() => {
                    const att = attendanceByUser[selected.id] ?? { pct: 0, workingDays: 0, leaveDays: 0 };
                    const presentDays = Math.max(0, att.workingDays - att.leaveDays);
                    return (
                      <div className="rounded-lg border border-border bg-muted/30 p-3 mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-ink-muted">Attendance this month</span>
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", attendanceColor(att.pct))}>
                            {att.pct}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              att.pct >= 95 ? "bg-green-500"
                              : att.pct >= 85 ? "bg-blue-500"
                              : att.pct >= 70 ? "bg-yellow-500"
                              : "bg-red-500"
                            )}
                            style={{ width: `${Math.min(100, Math.max(0, att.pct))}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-muted tabular-nums">
                          <span>Present: {presentDays}</span>
                          <span>Off: {att.leaveDays}</span>
                          <span>Working days: {att.workingDays}</span>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="rounded-lg border border-border bg-green-50 dark:bg-green-900/10 p-3 text-center">
                      <p className="text-lg font-semibold text-green-700 dark:text-green-400">{leaveCounts.approved}</p>
                      <p className="text-[11px] text-ink-muted">Approved</p>
                    </div>
                    <div className="rounded-lg border border-border bg-yellow-50 dark:bg-yellow-900/10 p-3 text-center">
                      <p className="text-lg font-semibold text-yellow-700 dark:text-yellow-400">{leaveCounts.pending}</p>
                      <p className="text-[11px] text-ink-muted">Pending</p>
                    </div>
                    <div className="rounded-lg border border-border bg-red-50 dark:bg-red-900/10 p-3 text-center">
                      <p className="text-lg font-semibold text-red-700 dark:text-red-400">{leaveCounts.rejected}</p>
                      <p className="text-[11px] text-ink-muted">Rejected</p>
                    </div>
                  </div>

                  {leaves.length === 0 ? (
                    <p className="text-sm text-ink-muted">No leave or permission records.</p>
                  ) : (
                    <ul className="space-y-2">
                      {leaves.map((l) => {
                        const sc = leaveStatusConfig[l.status];
                        const SIcon = sc.icon;
                        return (
                          <li key={l.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-ink-primary capitalize">
                                  {l.type}
                                  {l.leave_category ? ` · ${l.leave_category}` : ""}
                                </p>
                                <p className="text-xs text-ink-muted">
                                  {l.type === "permission"
                                    ? `${formatDate(l.start_date)} ${l.start_time ?? ""}${l.end_time ? ` – ${l.end_time}` : ""}`
                                    : `${formatDate(l.start_date)}${l.end_date && l.end_date !== l.start_date ? ` – ${formatDate(l.end_date)}` : ""}`}
                                </p>
                                {l.reason && (
                                  <p className="text-xs text-ink-muted mt-0.5 truncate">{l.reason}</p>
                                )}
                              </div>
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0", sc.color)}>
                                <SIcon className="h-3 w-3" />{sc.label}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-ink-muted shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="text-sm text-ink-primary truncate">{value}</p>
      </div>
    </div>
  );
}
