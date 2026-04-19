import { motion } from "framer-motion";
import { CheckSquare, Clock, CheckCircle2, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";

export default function InternAdminDashboard() {
  const { user, profile } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  // Fetch all interns
  const { data: interns = [] } = useQuery({
    queryKey: ["interns-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "intern")
        .eq("is_active", true);
      return data ?? [];
    },
    enabled: !!user,
  });

  // Fetch all tasks assigned to interns
  const { data: internTasks = [] } = useQuery({
    queryKey: ["intern-admin-tasks-overview", interns],
    queryFn: async () => {
      if (!interns.length) return [];
      const internIds = interns.map((i: any) => i.id);
      const { data: assigneeRows } = await supabase
        .from("task_assignees")
        .select("task_id")
        .in("user_id", internIds);
      if (!assigneeRows?.length) return [];
      const taskIds = [...new Set(assigneeRows.map((r: any) => r.task_id))];
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .in("id", taskIds)
        .order("deadline", { ascending: true });
      return data ?? [];
    },
    enabled: interns.length > 0,
  });

  // My tasks (assigned to me by admin/manager)
  const { data: myTasks = [] } = useQuery({
    queryKey: ["intern-admin-my-tasks", user?.id],
    queryFn: async () => {
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

  const totalInternTasks = internTasks.length;
  const completedInternTasks = internTasks.filter((t) => t.status === "completed").length;
  const dueTodayInternTasks = internTasks.filter(
    (t) => t.deadline === format(new Date(), "yyyy-MM-dd") && t.status !== "completed"
  ).length;
  const myPendingTasks = myTasks.filter((t) => t.status !== "completed").length;

  const recentInternTasks = internTasks.filter((t) => t.status !== "completed").slice(0, 5);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <AnimatedPage>
      <div className="mb-6">
        <h1 className="font-heading text-[26px] font-bold text-ink-primary">
          {greeting}, {firstName} 👋
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          {format(new Date(), "EEEE, dd MMMM yyyy")}
        </p>
        <span className="inline-block mt-2 rounded-full bg-warning/10 px-3 py-0.5 text-xs font-semibold text-warning">
          Intern Admin
        </span>
      </div>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 gap-4 mb-8"
      >
        <StatCard title="Total Interns" value={interns.length} icon={Users} iconBg="bg-purple-light" iconColor="text-purple" />
        <StatCard title="Intern Tasks" value={totalInternTasks} icon={CheckSquare} />
        <StatCard
          title="Completed"
          value={completedInternTasks}
          icon={CheckCircle2}
          iconBg="bg-success-light"
          iconColor="text-success"
        />
        <StatCard
          title="My Pending"
          value={myPendingTasks}
          icon={Clock}
          iconBg="bg-warning-light"
          iconColor="text-warning"
        />
      </motion.div>

      {dueTodayInternTasks > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-6 rounded-lg bg-warning-light px-4 py-3 flex items-center gap-2"
        >
          <span className="text-warning text-sm font-medium">
            ⚠ {dueTodayInternTasks} intern task{dueTodayInternTasks > 1 ? "s" : ""} due today
          </span>
        </motion.div>
      )}

      <div className="rounded-card bg-card p-5 shadow-card">
        <h3 className="text-sm font-semibold text-ink-primary mb-4">Active Intern Tasks</h3>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-3"
        >
          {recentInternTasks.map((task) => (
            <motion.div
              key={task.id}
              variants={staggerItem}
              className="flex items-center gap-3 rounded-lg p-3 hover:bg-muted transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-primary truncate">{task.title}</p>
                {task.deadline && (
                  <p className="text-xs text-ink-muted">
                    Due {format(new Date(task.deadline), "MMM d")}
                  </p>
                )}
              </div>
              <PriorityBadge priority={task.priority ?? "medium"} />
              <StatusBadge status={task.status ?? "todo"} />
              <div className="flex items-center gap-2 text-xs text-ink-muted w-20">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${task.progress ?? 0}%` }}
                    transition={{ duration: 0.6 }}
                    className="h-full rounded-full bg-primary"
                  />
                </div>
                {task.progress ?? 0}%
              </div>
            </motion.div>
          ))}
          {recentInternTasks.length === 0 && (
            <p className="py-8 text-center text-sm text-ink-muted">
              No active intern tasks.
            </p>
          )}
        </motion.div>
      </div>
    </AnimatedPage>
  );
}
