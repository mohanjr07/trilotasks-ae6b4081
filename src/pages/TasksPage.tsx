import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, X as XIcon, CheckSquare } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";
import UserAvatar from "@/components/UserAvatar";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CreateTaskModal from "@/components/CreateTaskModal";
import TaskDetailModal from "@/components/TaskDetailModal";

const TASK_CREATE_OPEN_KEY = "tasks:create-open";

export default function TasksPage({ myTasksOnly = false }: { myTasksOnly?: boolean }) {
  const { isAdmin, user, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const assigneeFilter = searchParams.get("assignee") || "all";
  const [createOpen, setCreateOpen] = useState(() => sessionStorage.getItem(TASK_CREATE_OPEN_KEY) === "1");
  const [selectedTask, setSelectedTask] = useState<any>(null);

  useEffect(() => {
    sessionStorage.setItem(TASK_CREATE_OPEN_KEY, createOpen ? "1" : "0");
  }, [createOpen]);

  const canCreateTasks = !myTasksOnly && (profile?.role === "admin" || profile?.role === "manager");
  const showAllTasks = isAdmin && !myTasksOnly;

  // ✅ FIXED QUERY
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", showAllTasks, user?.id, myTasksOnly],
    queryFn: async () => {
      if (showAllTasks) {
        const { data } = await supabase
          .from("tasks")
          .select("*")
          .order("created_at", { ascending: false });

        return data ?? [];
      }

      const { data: assignedTaskIds } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("user_id", user!.id);

      if (!assignedTaskIds?.length) return [];

      const taskIds = assignedTaskIds.map((a: any) => a.task_id);

      const { data } = await supabase
        .from("tasks")
        .select("*")
        .in("id", taskIds)
        .order("created_at", { ascending: false });

      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["members-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("is_active", true)
        .order("full_name");

      return data ?? [];
    },
    enabled: isAdmin,
  });

  const filteredTasks = tasks.filter((t: any) => {
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    return true;
  });

  const clearAll = () => {
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
  };

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">
          {myTasksOnly ? "My Tasks" : canCreateTasks ? "Tasks" : "My Tasks"}
        </h1>
        {canCreateTasks && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Create Task
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="pl-9 h-10"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-10">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[140px] h-10">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks yet"
          description="You don't have any tasks assigned yet."
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-2"
        >
          {filteredTasks.map((task: any) => (
            <motion.div
              key={task.id}
              variants={staggerItem}
              className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{task.title}</p>
              </div>
              <PriorityBadge priority={task.priority ?? "medium"} />
              <StatusBadge status={task.status ?? "todo"} />
              <div className="text-xs text-ink-muted">
                {task.deadline ? format(new Date(task.deadline), "MMM d") : "—"}
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
    </AnimatedPage>
  );
}
