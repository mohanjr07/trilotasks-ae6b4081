import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, X as XIcon, CheckSquare } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { toast } from "sonner";
import CreateTaskModal from "@/components/CreateTaskModal";
import TaskDetailModal from "@/components/TaskDetailModal";

export default function TasksPage() {
  const { isAdmin, user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const assigneeFilter = searchParams.get("assignee") || "all";
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", isAdmin, user?.id],
    queryFn: async () => {
      let q = supabase.from("tasks").select("*, assigned:profiles!tasks_assigned_to_fkey(id, full_name, avatar_url, email), assigner:profiles!tasks_assigned_by_fkey(full_name)");
      if (!isAdmin) q = q.eq("assigned_to", user!.id);
      const { data } = await q.order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["members-list"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, avatar_url").eq("is_active", true).order("full_name");
      return data ?? [];
    },
    enabled: isAdmin,
  });

  const filteredTasks = tasks.filter((t: any) => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (assigneeFilter !== "all" && t.assigned_to !== assigneeFilter) return false;
    return true;
  });

  const setAssignee = (val: string) => {
    const params = new URLSearchParams(searchParams);
    if (val === "all") params.delete("assignee");
    else params.set("assignee", val);
    setSearchParams(params);
  };

  const activeFilters: { label: string; value: string; clear: () => void }[] = [];
  if (statusFilter !== "all") activeFilters.push({ label: "Status", value: statusFilter.replace("_", " "), clear: () => setStatusFilter("all") });
  if (priorityFilter !== "all") activeFilters.push({ label: "Priority", value: priorityFilter, clear: () => setPriorityFilter("all") });
  if (assigneeFilter !== "all") {
    const member = members.find((m: any) => m.id === assigneeFilter);
    activeFilters.push({ label: "Assignee", value: member?.full_name ?? "Unknown", clear: () => setAssignee("all") });
  }

  const clearAll = () => {
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setAssignee("all");
  };

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">
          {isAdmin ? "Tasks" : "My Tasks"}
        </h1>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Create Task
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..." className="pl-9 h-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin && (
          <Select value={assigneeFilter} onValueChange={setAssignee}>
            <SelectTrigger className="w-[180px] h-10"><SelectValue placeholder="Assignee" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Members</SelectItem>
              {members.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>
                  <div className="flex items-center gap-2">
                    <UserAvatar name={m.full_name} avatarUrl={m.avatar_url} size="sm" />
                    <span>{m.full_name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {activeFilters.map((f) => (
            <span key={f.label} className="inline-flex items-center gap-1.5 rounded-pill bg-accent-light text-primary px-3 py-1 text-xs font-medium">
              {f.label}: <span className="capitalize">{f.value}</span>
              <button onClick={f.clear} className="hover:text-destructive"><XIcon className="h-3 w-3" /></button>
            </span>
          ))}
          <button onClick={clearAll} className="text-xs text-primary hover:underline">Clear all</button>
        </div>
      )}

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        tasks.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="No tasks yet"
            description={isAdmin ? "Create your first task to get started." : "You don't have any tasks assigned yet."}
            actionLabel={isAdmin ? "Create Task" : undefined}
            onAction={isAdmin ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <EmptyState icon={Search} title="No matching tasks" description="Try adjusting your filters." />
        )
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
          {filteredTasks.map((task: any) => (
            <motion.div
              key={task.id}
              variants={staggerItem}
              whileHover={{ scale: 1.002 }}
              onClick={() => setSelectedTask(task)}
              className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card cursor-pointer hover:shadow-card-hover transition-shadow"
            >
              <div className="hidden sm:block">
                <UserAvatar name={task.assigned?.full_name ?? "?"} avatarUrl={task.assigned?.avatar_url} size="sm" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-primary truncate">{task.title}</p>
                <p className="text-xs text-ink-muted">{task.assigned?.full_name}</p>
              </div>
              <PriorityBadge priority={task.priority ?? "medium"} />
              <StatusBadge status={task.status ?? "todo"} />
              <div className="hidden md:flex items-center gap-2 text-xs text-ink-muted w-24">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${task.progress ?? 0}%` }}
                    transition={{ duration: 0.6 }} className="h-full rounded-full bg-primary" />
                </div>
                {task.progress ?? 0}%
              </div>
              <div className="hidden lg:block text-xs text-ink-muted w-20 text-right">
                {task.deadline ? (
                  <span className={new Date(task.deadline) < new Date() && task.status !== "completed" ? "text-destructive font-medium" : ""}>
                    {format(new Date(task.deadline), "MMM d")}
                  </span>
                ) : "—"}
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
