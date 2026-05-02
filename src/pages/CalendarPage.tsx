import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon,
  X, Trash2, Search,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth,
  isSameDay, isToday, addMonths, subMonths, startOfWeek, endOfWeek,
  parseISO,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FILTER_OPTIONS = [
  { value: "all", label: "All Events" },
  { value: "tasks", label: "Tasks" },
  { value: "leaves", label: "Approved Leave" },
  { value: "holidays", label: "Holidays" },
];

export default function CalendarPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isAdminOrManager = profile?.role === "admin" || profile?.role === "manager";
  const isAdmin = profile?.role === "admin";
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [goToDate, setGoToDate] = useState("");
  const [filter, setFilter] = useState("all");

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  // Fetch tasks
  const { data: tasks = [] } = useQuery({
    queryKey: ["calendar-tasks", format(monthStart, "yyyy-MM"), profile?.role, profile?.id],
    queryFn: async () => {
      let q = supabase.from("tasks")
        .select("id, title, deadline, status, priority, assigned_to, assigned_by, profiles:profiles!tasks_assigned_to_fkey(full_name)")
        .gte("deadline", format(calStart, "yyyy-MM-dd"))
        .lte("deadline", format(calEnd, "yyyy-MM-dd"));
      if (!isAdminOrManager) q = q.eq("assigned_to", profile!.id);
      const { data } = await q;
      return data ?? [];
    },
    enabled: !!profile,
  });

  // Fetch leave requests
  const { data: leaves = [] } = useQuery({
    queryKey: ["calendar-leaves", format(monthStart, "yyyy-MM"), profile?.role, profile?.id],
    queryFn: async () => {
      // Try selecting the new is_half_day / reverted_at columns; gracefully
      // fall back to the older shape when the database hasn't been migrated.
      const baseCols = "id, type, leave_category, start_date, end_date, status, employee_id, employee:profiles!leave_requests_employee_id_fkey(full_name)";
      const newCols = `${baseCols}, is_half_day, half_day_period, reverted_at`;
      let q = supabase.from("leave_requests")
        .select(newCols)
        .eq("status", "approved")
        .lte("start_date", format(calEnd, "yyyy-MM-dd"))
        .gte("end_date", format(calStart, "yyyy-MM-dd"));
      if (!isAdminOrManager) q = q.eq("employee_id", profile!.id);
      let { data, error } = await q;
      if (error) {
        let q2 = supabase.from("leave_requests")
          .select(baseCols)
          .eq("status", "approved")
          .lte("start_date", format(calEnd, "yyyy-MM-dd"))
          .gte("end_date", format(calStart, "yyyy-MM-dd"));
        if (!isAdminOrManager) q2 = q2.eq("employee_id", profile!.id);
        const res = await q2;
        data = (res.data ?? []) as any;
      }
      // Hide reverted leaves from the calendar (they no longer count as leave)
      return (data ?? []).filter((r: any) => !r.reverted_at);
    },
    enabled: !!profile,
  });

  // Fetch holidays
  const { data: holidays = [] } = useQuery({
    queryKey: ["calendar-holidays", format(monthStart, "yyyy-MM")],
    queryFn: async () => {
      const { data } = await supabase.from("holidays")
        .select("*")
        .gte("date", format(calStart, "yyyy-MM-dd"))
        .lte("date", format(calEnd, "yyyy-MM-dd"))
        .order("date");
      return data ?? [];
    },
  });

  // Delete leave mutation
  const deleteLeave = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leave_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-leaves"] });
      toast.success("Leave entry deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Go to date handler
  const handleGoToDate = () => {
    if (!goToDate) return;
    const d = parseISO(goToDate);
    setCurrentMonth(startOfMonth(d));
    setSelectedDate(d);
    setGoToDate("");
  };

  // Build a map of date → events (filtered)
  const dateEvents = useMemo(() => {
    const map: Record<string, { tasks: any[]; leaves: any[]; holidays: any[] }> = {};
    const ensure = (k: string) => {
      if (!map[k]) map[k] = { tasks: [], leaves: [], holidays: [] };
      return map[k];
    };

    if (filter === "all" || filter === "tasks") {
      tasks.forEach((t: any) => {
        if (t.deadline) ensure(t.deadline).tasks.push(t);
      });
    }
    if (filter === "all" || filter === "leaves") {
      leaves.forEach((l: any) => {
        const start = parseISO(l.start_date);
        const end = l.end_date ? parseISO(l.end_date) : start;
        eachDayOfInterval({ start, end }).forEach((d) => {
          ensure(format(d, "yyyy-MM-dd")).leaves.push(l);
        });
      });
    }
    if (filter === "all" || filter === "holidays") {
      holidays.forEach((h: any) => {
        ensure(h.date).holidays.push(h);
      });
    }
    return map;
  }, [tasks, leaves, holidays, filter]);

  const selectedKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;
  const selectedEvents = selectedKey ? dateEvents[selectedKey] : null;

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">Calendar</h1>
        <div className="flex items-center gap-2">
          {/* Filter dropdown */}
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Go to Date */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Search className="h-4 w-4 mr-1.5" /> Go to Date
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="end">
              <div className="flex items-center gap-2">
                <Input type="date" value={goToDate} onChange={(e) => setGoToDate(e.target.value)} className="h-9" />
                <Button size="sm" onClick={handleGoToDate} disabled={!goToDate}>Go</Button>
              </div>
            </PopoverContent>
          </Popover>
          {isAdminOrManager && (
            <Button onClick={() => setShowHolidayModal(true)} size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Add Holiday
            </Button>
          )}
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 rounded-lg hover:bg-muted text-ink-secondary">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="font-heading text-xl font-bold text-ink-primary">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 rounded-lg hover:bg-muted text-ink-secondary">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> Tasks</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" /> Approved Leave</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-destructive" /> Holiday</span>
      </div>

      {/* Calendar Grid */}
      <div className="rounded-card bg-card shadow-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {DAY_NAMES.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-ink-muted">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key = format(day, "yyyy-MM-dd");
            const events = dateEvents[key];
            const inMonth = isSameMonth(day, currentMonth);
            const today_ = isToday(day);
            const selected = selectedDate && isSameDay(day, selectedDate);

            return (
              <button
                key={i}
                onClick={() => setSelectedDate(day)}
                className={`relative min-h-[72px] md:min-h-[90px] p-1 md:p-2 border-b border-r border-border text-left transition-colors
                  ${!inMonth ? "bg-muted/40" : "hover:bg-accent-light/40"}
                  ${selected ? "bg-accent-light ring-1 ring-primary" : ""}
                `}
              >
                <span className={`text-xs font-medium ${!inMonth ? "text-ink-muted/50" : today_ ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground" : "text-ink-primary"}`}>
                  {format(day, "d")}
                </span>

                {events && (
                  <div className="mt-1 space-y-0.5">
                    {events.holidays.slice(0, 1).map((h: any) => (
                      <div key={h.id} className="truncate text-[10px] md:text-xs rounded px-1 py-0.5 bg-destructive/10 text-destructive font-medium">
                        {h.title}
                      </div>
                    ))}
                    {events.tasks.slice(0, 2).map((t: any) => (
                      <div key={t.id} className="truncate text-[10px] md:text-xs rounded px-1 py-0.5 bg-primary/10 text-primary">
                        {t.title}
                      </div>
                    ))}
                    {events.leaves.slice(0, 1).map((l: any, idx: number) => (
                      <div key={idx} className="truncate text-[10px] md:text-xs rounded px-1 py-0.5 bg-success/10 text-success">
                        {isAdminOrManager ? (l as any).employee?.full_name : l.type}
                      </div>
                    ))}
                    {(events.tasks.length + events.leaves.length + events.holidays.length) > 3 && (
                      <div className="text-[10px] text-ink-muted">
                        +{events.tasks.length + events.leaves.length + events.holidays.length - 3} more
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail panel */}
      <AnimatePresence>
        {selectedDate && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
            className="mt-4 rounded-card bg-card p-5 shadow-card"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading text-lg font-bold text-ink-primary">
                {format(selectedDate, "EEEE, MMMM d, yyyy")}
              </h3>
              <button onClick={() => setSelectedDate(null)} className="text-ink-muted hover:text-ink-primary">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Holidays */}
            {selectedEvents?.holidays.map((h: any) => (
              <div key={h.id} className="flex items-center gap-3 rounded-lg bg-destructive/5 border border-destructive/20 p-3 mb-2">
                <CalendarIcon className="h-4 w-4 text-destructive shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-primary">{h.title}</p>
                  <p className="text-xs text-ink-muted capitalize">{h.type} holiday{h.description ? ` · ${h.description}` : ""}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium capitalize">{h.type}</span>
              </div>
            ))}

            {/* Tasks */}
            {selectedEvents?.tasks.length ? (
              <div className="mb-3">
                <h4 className="text-xs font-semibold text-ink-muted uppercase mb-2">Tasks ({selectedEvents.tasks.length})</h4>
                <div className="space-y-2">
                  {selectedEvents.tasks.map((t: any) => (
                    <div key={t.id} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-primary truncate">{t.title}</p>
                        {isAdminOrManager && t.profiles && <p className="text-xs text-ink-muted">{(t.profiles as any)?.full_name}</p>}
                      </div>
                      <StatusBadge status={t.status ?? "todo"} />
                      <PriorityBadge priority={t.priority ?? "medium"} />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Leaves */}
            {selectedEvents?.leaves.length ? (
              <div>
                <h4 className="text-xs font-semibold text-ink-muted uppercase mb-2">Approved Leave ({selectedEvents.leaves.length})</h4>
                <div className="space-y-2">
                  {selectedEvents.leaves.map((l: any, idx: number) => (
                    <div key={`${l.id}-${idx}`} className="flex items-center gap-3 rounded-lg bg-success/5 border border-success/20 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-primary">
                          {isAdminOrManager ? (l as any).employee?.full_name : "Your leave"}
                        </p>
                        <p className="text-xs text-ink-muted capitalize">{l.type}{l.leave_category ? ` · ${l.leave_category}` : ""}{l.is_half_day ? ` · Half Day${l.half_day_period ? ` (${l.half_day_period})` : ""}` : ""}</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">Approved</span>
                      {isAdminOrManager && (
                        <button
                          onClick={() => { if (confirm("Delete this leave entry?")) deleteLeave.mutate(l.id); }}
                          className="text-ink-muted hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {!selectedEvents?.tasks.length && !selectedEvents?.leaves.length && !selectedEvents?.holidays.length && (
              <p className="text-sm text-ink-muted text-center py-6">No events on this day</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upcoming Holidays Section */}
      <div className="mt-6">
        <h3 className="font-heading text-lg font-bold text-ink-primary mb-3">Upcoming Holidays</h3>
        <UpcomingHolidays isAdminOrManager={isAdminOrManager} />
      </div>

      {/* Add Holiday Modal */}
      {isAdminOrManager && <AddHolidayModal open={showHolidayModal} onClose={() => setShowHolidayModal(false)} />}
    </AnimatedPage>
  );
}

function UpcomingHolidays({ isAdminOrManager }: { isAdminOrManager: boolean }) {
  const queryClient = useQueryClient();
  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["upcoming-holidays"],
    queryFn: async () => {
      const { data } = await supabase.from("holidays")
        .select("*")
        .gte("date", format(new Date(), "yyyy-MM-dd"))
        .order("date")
        .limit(10);
      return data ?? [];
    },
  });

  const deleteHoliday = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("holidays").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upcoming-holidays"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-holidays"] });
      toast.success("Holiday deleted");
    },
  });

  if (isLoading) return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>;

  if (!holidays.length) return (
    <div className="text-center py-8 text-sm text-ink-muted">
      No upcoming holidays scheduled
    </div>
  );

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
      {holidays.map((h: any) => (
        <motion.div key={h.id} variants={staggerItem}
          className="flex items-center gap-4 rounded-card bg-card p-4 shadow-card hover:shadow-card-hover transition-shadow">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
            <CalendarIcon className="h-5 w-5 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink-primary">{h.title}</p>
            <p className="text-xs text-ink-muted">
              {format(parseISO(h.date), "EEEE, MMMM d, yyyy")}
              {h.description ? ` · ${h.description}` : ""}
            </p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
            h.type === "government" ? "bg-destructive/10 text-destructive" :
            h.type === "company" ? "bg-primary/10 text-primary" :
            "bg-warning/10 text-warning"
          }`}>{h.type}</span>
          {isAdminOrManager && (
            <button onClick={() => { if (confirm("Delete this holiday?")) deleteHoliday.mutate(h.id); }}
              className="text-ink-muted hover:text-destructive transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </motion.div>
      ))}
    </motion.div>
  );
}

function AddHolidayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState("government");
  const [description, setDescription] = useState("");
  const [autoCreateLeave, setAutoCreateLeave] = useState(true);

  const create = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !date) { toast.error("Title and date are required"); return; }
      
      // Create the holiday
      const { error } = await supabase.from("holidays").insert([{
        title: title.trim(),
        date,
        type,
        description: description.trim() || null,
        created_by: user!.id,
      }]);
      if (error) throw error;

      // Auto-create leave entries for government holidays
      if (type === "government" && autoCreateLeave) {
        // Get all active employees
        const { data: employees } = await supabase.from("profiles")
          .select("id")
          .eq("is_active", true);
        
        if (employees && employees.length > 0) {
          // Check for existing holiday leaves on this date to prevent duplicates
          const { data: existingLeaves } = await supabase.from("leave_requests")
            .select("employee_id")
            .eq("start_date", date)
            .eq("end_date", date)
            .eq("type", "holiday")
            .eq("status", "approved");
          
          const existingEmployeeIds = new Set((existingLeaves ?? []).map((l: any) => l.employee_id));
          
          const newLeaves = employees
            .filter((e: any) => !existingEmployeeIds.has(e.id))
            .map((e: any) => ({
              employee_id: e.id,
              type: "holiday" as string,
              leave_category: "government_holiday" as string,
              reason: `Government Holiday: ${title.trim()}`,
              start_date: date,
              end_date: date,
              status: "approved" as string,
              reviewed_by: user!.id,
              reviewed_at: new Date().toISOString(),
            }));
          
          if (newLeaves.length > 0) {
            await supabase.from("leave_requests").insert(newLeaves);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-holidays"] });
      queryClient.invalidateQueries({ queryKey: ["upcoming-holidays"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-leaves"] });
      toast.success("Holiday added" + (type === "government" && autoCreateLeave ? " & leave auto-created for all employees" : ""));
      setTitle(""); setDate(""); setType("government"); setDescription(""); setAutoCreateLeave(true);
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-[460px] rounded-modal bg-card p-6 shadow-modal mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-bold text-ink-primary">Add Holiday</h2>
              <button onClick={onClose} className="text-ink-muted hover:text-ink-primary"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Title *</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Republic Day" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Date *</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Type</label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="government">Government</SelectItem>
                    <SelectItem value="company">Company</SelectItem>
                    <SelectItem value="optional">Optional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {type === "government" && (
                <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer">
                  <input type="checkbox" checked={autoCreateLeave} onChange={(e) => setAutoCreateLeave(e.target.checked)} className="accent-primary rounded" />
                  Auto-create approved leave for all employees
                </label>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Description</label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional description..." />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
                <Button onClick={() => create.mutate()} disabled={create.isPending} className="flex-1">
                  {create.isPending ? "Adding..." : "Add Holiday"}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
