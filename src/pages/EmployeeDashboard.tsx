import { motion } from "framer-motion";
import { CheckSquare, Clock, CheckCircle2, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";

export default function EmployeeDashboard() {
  const { user, profile } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  const { data: tasks = [] } = useQuery({
    queryKey: ["my-tasks", user?.id],
    queryFn: async () => {
      // Fetch via task_assignees so multi-assignee tasks are included
      const { data: assignedIds } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("user_id", user!.id);
      if (!assignedIds?.length) return [];
      const ids = assignedIds.map((a: any) => a.task_id);
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .in("id", ids)
        .order("deadline", { ascending: true });
      return data ?? [];
    },
    enabled: !!user,
  });

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const dueToday = tasks.filter((t) => t.deadline === format(new Date(), "yyyy-MM-dd") && t.status !== "completed").length;
  const avgProgress = total ? Math.round(tasks.reduce((s, t) => s + (t.progress ?? 0), 0) / total) : 0;

  const activeTasks = tasks.filter((t) => t.status !== "completed").slice(0, 5);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <AnimatedPage>
      <div className="mb-6">
        <h1 className="font-heading text-[26px] font-bold text-ink-primary">{greeting}, {firstName} 👋</h1>
        <p className="text-sm text-ink-muted mt-1">{format(new Date(), "EEEE, dd MMMM yyyy")}</p>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 gap-4 mb-8">
        <StatCard title="My Tasks" value={total} icon={CheckSquare} />
        <StatCard title="Due Today" value={dueToday} icon={Clock} iconBg="bg-warning-light" iconColor="text-warning" />
        <StatCard title="Completed" value={completed} icon={CheckCircle2} iconBg="bg-success-light" iconColor="text-success" />
        <StatCard title="My Progress" value={avgProgress} subtitle="Average %" icon={TrendingUp} iconBg="bg-purple-light" iconColor="text-purple" />
      </motion.div>

      {dueToday > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 rounded-lg bg-warning-light px-4 py-3 flex items-center gap-2">
          <span className="text-warning text-sm font-medium">⚠ You have {dueToday} task{dueToday > 1 ? "s" : ""} due today</span>
        </motion.div>
      )}

      <div className="rounded-card bg-card p-5 shadow-card">
        <h3 className="text-sm font-semibold text-ink-primary mb-4">Active Tasks</h3>
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-3">
          {activeTasks.map((task) => (
            <motion.div key={task.id} variants={staggerItem} className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted transition-colors">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-primary truncate">{task.title}</p>
                {task.deadline && <p className="text-xs text-ink-muted">Due {format(new Date(task.deadline), "MMM d")}</p>}
              </div>
              <PriorityBadge priority={task.priority ?? "medium"} />
              <StatusBadge status={task.status ?? "todo"} />
              <div className="flex items-center gap-2 text-xs text-ink-muted w-20">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${task.progress}%` }} transition={{ duration: 0.6 }} className="h-full rounded-full bg-primary" />
                </div>
                {task.progress}%
              </div>
            </motion.div>
          ))}
          {activeTasks.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-muted">No active tasks. Great job! 🎉</p>
          )}
        </motion.div>
      </div>
    </AnimatedPage>
  );
}
