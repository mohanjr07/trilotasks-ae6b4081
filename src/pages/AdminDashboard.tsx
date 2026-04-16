import { useState } from "react";
import { motion } from "framer-motion";
import { CheckSquare, Clock, CheckCircle2, AlertTriangle, Plus, ClipboardList } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays } from "date-fns";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";
import UserAvatar from "@/components/UserAvatar";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import TaskDetailModal from "@/components/TaskDetailModal";

const COLORS = ["hsl(224,72%,53%)", "hsl(142,72%,39%)", "hsl(32,95%,44%)", "hsl(0,72%,51%)"];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const isManager = profile?.role === "manager";
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const { data: tasks = [] } = useQuery({
    queryKey: ["admin-tasks"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("*, task_assignees(user_id, user:profiles(id, full_name, avatar_url))")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Manager's own assigned tasks
  const { data: myTasks = [] } = useQuery({
    queryKey: ["manager-my-tasks", user?.id],
    queryFn: async () => {
      const { data: assignedIds } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("user_id", user!.id);
      if (!assignedIds?.length) return [];
      const ids = assignedIds.map((a: any) => a.task_id);
      const { data } = await supabase
        .from("tasks")
        .select("*, assigner:profiles!tasks_assigned_by_fkey(full_name), task_assignees(user_id, user:profiles(id, full_name, avatar_url))")
        .in("id", ids)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: isManager && !!user,
  });

  const total = tasks.length;
  const completed = tasks.filter((t: any) => t.status === "completed").length;
  const inProgress = tasks.filter((t: any) => t.status === "in_progress").length;
  const overdue = tasks.filter((t: any) => t.deadline && new Date(t.deadline) < new Date() && t.status !== "completed").length;

  const statusData = [
    { name: "To Do", value: tasks.filter((t: any) => t.status === "todo").length },
    { name: "In Progress", value: inProgress },
    { name: "On Hold", value: tasks.filter((t: any) => t.status === "on_hold").length },
    { name: "Completed", value: completed },
  ].filter(d => d.value > 0);

  // Build real trend data from tasks
  const trendData = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dayStr = format(date, "yyyy-MM-dd");
    const count = tasks.filter((t: any) => t.status === "completed" && t.updated_at && format(new Date(t.updated_at), "yyyy-MM-dd") === dayStr).length;
    return { day: format(date, "EEE"), completed: count };
  });

  if (total === 0) {
    return (
      <AnimatedPage>
        <h1 className="font-heading text-[28px] font-bold text-ink-primary mb-6">Dashboard</h1>
        <EmptyState
          icon={CheckSquare}
          title="Welcome to TaskFlow!"
          description="Get started by creating your first task or adding team members."
          actionLabel="Create your first task"
          onAction={() => navigate("/tasks")}
        />
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <h1 className="font-heading text-[28px] font-bold text-ink-primary mb-6">Dashboard</h1>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="Total Tasks" value={total} subtitle="All tasks" icon={CheckSquare} />
        <StatCard title="Completed" value={completed} subtitle={total ? `${Math.round((completed / total) * 100)}% rate` : "0%"} icon={CheckCircle2} iconBg="bg-success-light" iconColor="text-success" />
        <StatCard title="In Progress" value={inProgress} icon={Clock} iconBg="bg-accent-light" iconColor="text-primary" />
        <StatCard title="Overdue" value={overdue} subtitle={overdue > 0 ? "Needs attention" : "All on track"} icon={AlertTriangle} iconBg="bg-destructive-light" iconColor="text-destructive" />
      </motion.div>

      <div className="grid lg:grid-cols-5 gap-6 mb-8">
        <div className="lg:col-span-3 rounded-card bg-card p-5 shadow-card">
          <h3 className="text-sm font-semibold text-ink-primary mb-4">Task Completion Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="colorComp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(224,72%,53%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(224,72%,53%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(60,3%,41%)" }} />
              <YAxis hide />
              <Tooltip contentStyle={{ borderRadius: 12, border: "none", boxShadow: "var(--shadow-md)" }} />
              <Area type="monotone" dataKey="completed" stroke="hsl(224,72%,53%)" fillOpacity={1} fill="url(#colorComp)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="lg:col-span-2 rounded-card bg-card p-5 shadow-card">
          <h3 className="text-sm font-semibold text-ink-primary mb-4">By Status</h3>
          {statusData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={4} dataKey="value">
                    {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 justify-center mt-2">
                {statusData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs text-ink-secondary">
                    <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    {d.name}: {d.value}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-ink-muted py-8">No data yet</p>
          )}
        </div>
      </div>

      {/* Manager's own assigned tasks */}
      {isManager && (
        <div className="rounded-card bg-card p-5 shadow-card mb-8">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-ink-primary">My Tasks</h3>
            <span className="ml-auto text-xs text-ink-muted">{myTasks.length} task{myTasks.length !== 1 ? "s" : ""}</span>
          </div>
          {myTasks.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">No tasks assigned to you yet.</p>
          ) : (
            <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
              {myTasks.map((task: any) => (
                <motion.div
                  key={task.id}
                  variants={staggerItem}
                  onClick={() => setSelectedTask(task)}
                  className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted transition-colors cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-primary truncate">{task.title}</p>
                    <p className="text-xs text-ink-muted">Assigned by {task.assigner?.full_name ?? "Admin"}</p>
                  </div>
                  <PriorityBadge priority={task.priority ?? "medium"} />
                  <StatusBadge status={task.status ?? "todo"} />
                  <div className="hidden sm:flex items-center gap-2 text-xs text-ink-muted w-24">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${task.progress ?? 0}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
                        className="h-full rounded-full bg-primary" />
                    </div>
                    {task.progress ?? 0}%
                  </div>
                  <div className="hidden lg:block text-xs text-ink-muted w-20 text-right">
                    {task.deadline ? format(new Date(task.deadline), "MMM d") : "—"}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      )}

      <div className="rounded-card bg-card p-5 shadow-card">
        <h3 className="text-sm font-semibold text-ink-primary mb-4">Recent Tasks</h3>
        <div className="space-y-3">
          {tasks.slice(0, 5).map((task: any) => {
            const assignees = task.task_assignees?.map((a: any) => a.user) ?? [];
            const primary = assignees[0];
            return (
              <div key={task.id} className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted transition-colors">
                <UserAvatar name={primary?.full_name ?? "?"} avatarUrl={primary?.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-primary truncate">{task.title}</p>
                  <p className="text-xs text-ink-muted">
                    {assignees.length === 0 ? "Unassigned" : assignees.length === 1 ? primary?.full_name : `${primary?.full_name} +${assignees.length - 1} more`}
                  </p>
                </div>
                <PriorityBadge priority={task.priority} />
                <StatusBadge status={task.status} />
                <div className="hidden sm:flex items-center gap-2 text-xs text-ink-muted w-24">
                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${task.progress}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
                      className="h-full rounded-full bg-primary" />
                  </div>
                  {task.progress}%
                </div>
              </div>
            );
          })}
          {tasks.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-muted">No tasks yet. Create one to get started.</p>
          )}
        </div>
      </div>

      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
    </AnimatedPage>
  );
}
