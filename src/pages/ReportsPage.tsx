import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { BarChart3, CheckCircle2, Clock, AlertTriangle, Download, Calendar } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, CartesianGrid,
} from "recharts";
import { format, subDays, subMonths, startOfWeek, startOfMonth, startOfQuarter, differenceInDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import AnimatedPage, { staggerContainer } from "@/components/AnimatedPage";
import StatCard from "@/components/StatCard";
import UserAvatar from "@/components/UserAvatar";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

const COLORS = {
  status: ["hsl(60,2%,66%)", "hsl(224,72%,53%)", "hsl(32,95%,44%)", "hsl(142,72%,39%)"],
  priority: ["hsl(0,72%,51%)", "hsl(32,95%,44%)", "hsl(142,72%,39%)"],
  leave: ["hsl(32,95%,44%)", "hsl(142,72%,39%)", "hsl(0,72%,51%)"],
};

type Range = "week" | "month" | "quarter";

export default function ReportsPage() {
  const [range, setRange] = useState<Range>("month");

  const startDate = useMemo(() => {
    const now = new Date();
    if (range === "week") return startOfWeek(now);
    if (range === "month") return startOfMonth(now);
    return startOfQuarter(now);
  }, [range]);

  const { data: tasks = [] } = useQuery({
    queryKey: ["report-tasks"],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("*, assigned:profiles!tasks_assigned_to_fkey(id, full_name, avatar_url)");
      return data ?? [];
    },
  });

  const { data: leaveRequests = [] } = useQuery({
    queryKey: ["report-leave"],
    queryFn: async () => {
      const { data } = await supabase.from("leave_requests").select("*");
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["report-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, avatar_url").eq("is_active", true);
      return data ?? [];
    },
  });

  // Task stats
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t: any) => t.status === "completed").length;
  const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const overdueTasks = tasks.filter((t: any) => t.deadline && new Date(t.deadline) < new Date() && t.status !== "completed").length;
  const overdueRate = totalTasks ? Math.round((overdueTasks / totalTasks) * 100) : 0;

  // Avg days to complete
  const completedWithDates = tasks.filter((t: any) => t.status === "completed" && t.created_at && t.updated_at);
  const avgDays = completedWithDates.length > 0
    ? Math.round(completedWithDates.reduce((s: number, t: any) => s + differenceInDays(new Date(t.updated_at), new Date(t.created_at)), 0) / completedWithDates.length)
    : 0;

  // Status donut
  const statusData = [
    { name: "To Do", value: tasks.filter((t: any) => t.status === "todo").length },
    { name: "In Progress", value: tasks.filter((t: any) => t.status === "in_progress").length },
    { name: "On Hold", value: tasks.filter((t: any) => t.status === "on_hold").length },
    { name: "Completed", value: completedTasks },
  ].filter(d => d.value > 0);

  // Priority bar
  const priorityData = [
    { name: "High", value: tasks.filter((t: any) => t.priority === "high").length },
    { name: "Medium", value: tasks.filter((t: any) => t.priority === "medium").length },
    { name: "Low", value: tasks.filter((t: any) => t.priority === "low").length },
  ];

  // Trend data
  const days = range === "week" ? 7 : range === "month" ? 30 : 90;
  const trendData = Array.from({ length: Math.min(days, 14) }, (_, i) => {
    const date = subDays(new Date(), Math.min(days, 14) - 1 - i);
    const dayStr = format(date, "yyyy-MM-dd");
    const count = tasks.filter((t: any) => t.status === "completed" && t.updated_at && format(new Date(t.updated_at), "yyyy-MM-dd") === dayStr).length;
    return { day: format(date, "MMM d"), completed: count };
  });

  // Team performance
  const teamPerformance = profiles.map((p: any) => {
    const pTasks = tasks.filter((t: any) => t.assigned_to === p.id);
    const pCompleted = pTasks.filter((t: any) => t.status === "completed").length;
    const pInProgress = pTasks.filter((t: any) => t.status === "in_progress").length;
    const pOverdue = pTasks.filter((t: any) => t.deadline && new Date(t.deadline) < new Date() && t.status !== "completed").length;
    const rate = pTasks.length ? Math.round((pCompleted / pTasks.length) * 100) : 0;
    return { ...p, assigned: pTasks.length, completed: pCompleted, inProgress: pInProgress, overdue: pOverdue, rate };
  }).sort((a, b) => b.rate - a.rate);

  // Leave stats — exclude reverted leaves from the "approved" count
  // (a reverted leave is no longer effectively a leave).
  const totalLeave = leaveRequests.length;
  const approvedLeave = leaveRequests.filter(
    (r: any) => r.status === "approved" && !r.reverted_at
  ).length;
  const approvalRate = totalLeave ? Math.round((approvedLeave / totalLeave) * 100) : 0;
  const leaveTypes = leaveRequests.reduce((acc: Record<string, number>, r: any) => { acc[r.type] = (acc[r.type] ?? 0) + 1; return acc; }, {});
  const mostCommonType = Object.entries(leaveTypes).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] ?? "—";

  const leaveStatusData = [
    { name: "Pending", value: leaveRequests.filter((r: any) => r.status === "pending").length },
    { name: "Approved", value: approvedLeave },
    { name: "Rejected", value: leaveRequests.filter((r: any) => r.status === "rejected").length },
  ].filter(d => d.value > 0);

  const exportCSV = (data: any[], filename: string) => {
    if (data.length === 0) return;
    const keys = Object.keys(data[0]);
    const csv = [keys.join(","), ...data.map(row => keys.map(k => `"${row[k] ?? ""}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `taskflow-${filename}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
  };

  if (totalTasks === 0 && totalLeave === 0) {
    return (
      <AnimatedPage>
        <h1 className="font-heading text-[28px] font-bold text-ink-primary mb-6">Reports</h1>
        <EmptyState icon={BarChart3} title="No data yet" description="Reports will appear once you have tasks and leave requests." />
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">Reports</h1>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {(["week", "month", "quarter"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${range === r ? "bg-primary text-primary-foreground" : "text-ink-secondary hover:bg-muted"}`}>
              This {r}
            </button>
          ))}
        </div>
      </div>

      {/* Task Overview */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-xl font-semibold text-ink-primary">Task Overview</h2>
          <Button variant="outline" size="sm" onClick={() => exportCSV(teamPerformance.map(p => ({ name: p.full_name, assigned: p.assigned, completed: p.completed, rate: p.rate })), "tasks")} className="gap-2">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>

        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard title="Total Tasks" value={totalTasks} icon={CheckCircle2} />
          <StatCard title="Completion Rate" value={completionRate} subtitle="%" icon={BarChart3} iconBg="bg-success-light" iconColor="text-success" />
          <StatCard title="Avg Days" value={avgDays} subtitle="to complete" icon={Clock} iconBg="bg-accent-light" iconColor="text-primary" />
          <StatCard title="Overdue Rate" value={overdueRate} subtitle="%" icon={AlertTriangle} iconBg="bg-destructive-light" iconColor="text-destructive" />
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6 mb-6">
          <div className="rounded-card bg-card p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink-primary mb-4">Task Completion Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData}>
                <defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(224,72%,53%)" stopOpacity={0.2} /><stop offset="95%" stopColor="hsl(224,72%,53%)" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(60,3%,41%)" }} />
                <YAxis hide />
                <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "var(--shadow-md)" }} />
                <Area type="monotone" dataKey="completed" stroke="hsl(224,72%,53%)" fill="url(#trendGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-card bg-card p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink-primary mb-4">Tasks by Status</h3>
            {statusData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart><Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={4} dataKey="value">
                    {statusData.map((_, i) => <Cell key={i} fill={COLORS.status[i % COLORS.status.length]} />)}
                  </Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 justify-center mt-2">
                  {statusData.map((d, i) => (
                    <span key={d.name} className="flex items-center gap-1.5 text-xs text-ink-secondary">
                      <span className="h-2 w-2 rounded-full" style={{ background: COLORS.status[i] }} />{d.name}: {d.value}
                    </span>
                  ))}
                </div>
              </>
            ) : <p className="text-center py-8 text-sm text-ink-muted">No data</p>}
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-card bg-card p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink-primary mb-4">Tasks by Priority</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={priorityData} layout="vertical">
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(60,3%,41%)" }} width={60} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "none" }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {priorityData.map((_, i) => <Cell key={i} fill={COLORS.priority[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-card bg-card p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink-primary mb-4">Tasks by Category</h3>
            {(() => {
              const cats = tasks.reduce((acc: Record<string, number>, t: any) => {
                const c = t.category || "Uncategorized";
                acc[c] = (acc[c] ?? 0) + 1;
                return acc;
              }, {});
              const catData = Object.entries(cats).map(([name, value]) => ({ name, value })).sort((a, b) => (b.value as number) - (a.value as number)).slice(0, 5);
              if (catData.length === 0) return <p className="text-center py-8 text-sm text-ink-muted">No categories</p>;
              return (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={catData} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "hsl(60,3%,41%)" }} width={80} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "none" }} />
                    <Bar dataKey="value" fill="hsl(224,72%,53%)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>
        </div>
      </section>

      {/* Team Performance */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-xl font-semibold text-ink-primary">Team Performance</h2>
          <Button variant="outline" size="sm" onClick={() => exportCSV(teamPerformance.map(p => ({ name: p.full_name, assigned: p.assigned, completed: p.completed, in_progress: p.inProgress, overdue: p.overdue, completion_rate: p.rate })), "team")} className="gap-2">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
        <div className="rounded-card bg-card shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-muted uppercase">Employee</th>
                  <th className="text-center px-3 py-3 text-xs font-medium text-ink-muted uppercase">Assigned</th>
                  <th className="text-center px-3 py-3 text-xs font-medium text-ink-muted uppercase">Done</th>
                  <th className="text-center px-3 py-3 text-xs font-medium text-ink-muted uppercase hidden sm:table-cell">Active</th>
                  <th className="text-center px-3 py-3 text-xs font-medium text-ink-muted uppercase hidden sm:table-cell">Overdue</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-ink-muted uppercase">Completion %</th>
                </tr>
              </thead>
              <tbody>
                {teamPerformance.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="sm" />
                        <span className="font-medium text-ink-primary">{p.full_name}</span>
                      </div>
                    </td>
                    <td className="text-center px-3 py-3 text-ink-secondary">{p.assigned}</td>
                    <td className="text-center px-3 py-3 text-success">{p.completed}</td>
                    <td className="text-center px-3 py-3 text-ink-secondary hidden sm:table-cell">{p.inProgress}</td>
                    <td className="text-center px-3 py-3 hidden sm:table-cell"><span className={p.overdue > 0 ? "text-destructive font-medium" : "text-ink-secondary"}>{p.overdue}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${p.rate}%` }} />
                        </div>
                        <span className="text-xs font-medium text-ink-primary w-8 text-right">{p.rate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Leave Summary */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading text-xl font-semibold text-ink-primary">Leave & Permissions</h2>
        </div>
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-3 gap-4 mb-6">
          <StatCard title="Total Requests" value={totalLeave} icon={Calendar} />
          <StatCard title="Approval Rate" value={approvalRate} subtitle="%" icon={CheckCircle2} iconBg="bg-success-light" iconColor="text-success" />
          <StatCard title="Most Common" value={0} subtitle={mostCommonType} icon={BarChart3} iconBg="bg-purple-light" iconColor="text-purple" />
        </motion.div>

        {leaveStatusData.length > 0 && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-card bg-card p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink-primary mb-4">Request Status</h3>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart><Pie data={leaveStatusData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={4} dataKey="value">
                  {leaveStatusData.map((_, i) => <Cell key={i} fill={COLORS.leave[i % COLORS.leave.length]} />)}
                </Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 justify-center mt-2">
                {leaveStatusData.map((d, i) => (
                  <span key={d.name} className="flex items-center gap-1.5 text-xs text-ink-secondary">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS.leave[i] }} />{d.name}: {d.value}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-card bg-card p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink-primary mb-4">Leave by Category</h3>
              {(() => {
                const cats = leaveRequests.reduce((acc: Record<string, { total: number; approved: number; rejected: number }>, r: any) => {
                  const c = r.leave_category || r.type;
                  if (!acc[c]) acc[c] = { total: 0, approved: 0, rejected: 0 };
                  acc[c].total++;
                  // Reverted leaves no longer count as approved
                  if (r.status === "approved" && !r.reverted_at) acc[c].approved++;
                  if (r.status === "rejected") acc[c].rejected++;
                  return acc;
                }, {});
                const data = Object.entries(cats).map(([name, v]) => ({ name, ...v, rate: v.total ? Math.round((v.approved / v.total) * 100) : 0 }));
                if (data.length === 0) return <p className="text-center py-8 text-sm text-ink-muted">No data</p>;
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-xs text-ink-muted capitalize">Category</th>
                        <th className="text-center px-3 py-2 text-xs text-ink-muted">Total</th>
                        <th className="text-center px-3 py-2 text-xs text-ink-muted">Approved</th>
                        <th className="text-center px-3 py-2 text-xs text-ink-muted">Rate</th>
                      </tr></thead>
                      <tbody>
                        {data.map(d => (
                          <tr key={d.name} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 capitalize text-ink-primary">{d.name}</td>
                            <td className="text-center px-3 py-2 text-ink-secondary">{d.total}</td>
                            <td className="text-center px-3 py-2 text-success">{d.approved}</td>
                            <td className="text-center px-3 py-2 text-ink-primary font-medium">{d.rate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </section>
    </AnimatedPage>
  );
}
