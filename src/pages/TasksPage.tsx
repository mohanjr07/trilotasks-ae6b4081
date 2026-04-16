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
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import CreateTaskModal from "@/components/CreateTaskModal";
import TaskDetailModal from "@/components/TaskDetailModal";

export default function TasksPage({ myTasksOnly = false }: { myTasksOnly?: boolean }) {
  const { isAdmin, user, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const canCreateTasks = profile?.role === "admin" || profile?.role === "manager";

  // ✅ FIXED QUERY (NO JOINS → NO 500 ERROR)
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: async () => {
      // 1. Get tasks
      const { data: tasksData, error: tasksError } = await supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false });

      if (tasksError) {
        console.error("TASK ERROR:", tasksError);
        return [];
      }

      // 2. Get assignees
      const { data: assigneesData } = await supabase
        .from("task_assignees")
        .select("task_id, user_id");

      // 3. Attach assignees to tasks
      const mapped = tasksData.map((task: any) => ({
        ...task,
        task_assignees:
          assigneesData?.filter((a: any) => a.task_id === task.id) || [],
      }));

      return mapped;
    },
    enabled: !!user,
  });

  const filteredTasks = tasks.filter((t: any) => {
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    return true;
  });

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          {myTasksOnly ? "My Tasks" : "Tasks"}
        </h1>

        {canCreateTasks && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Task
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <Input
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {isLoading ? (
        <p>Loading...</p>
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks yet"
          description="No tasks found."
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
              className="p-4 bg-white rounded shadow cursor-pointer"
              onClick={() => setSelectedTask(task)}
            >
              <p className="font-semibold">{task.title}</p>
              <div className="flex gap-2 mt-2">
                <PriorityBadge priority={task.priority ?? "medium"} />
                <StatusBadge status={task.status ?? "todo"} />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {task.deadline
                  ? format(new Date(task.deadline), "MMM d")
                  : "No deadline"}
              </p>
            </motion.div>
          ))}
        </motion.div>
      )}

      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
    </AnimatedPage>
  );
}
