import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Search, X as XIcon, CheckSquare, LayoutGrid, List } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { toast } from "sonner";

const TASK_CREATE_OPEN_KEY = "tasks:create-open";

const COLUMNS = [
  { key: "todo",        label: "To Do",       color: "#6366f1" },
  { key: "in_progress", label: "In Progress",  color: "#f59e0b" },
  { key: "on_hold",     label: "On Hold",      color: "#ef4444" },
  { key: "completed",   label: "Completed",    color: "#10b981" },
];

export default function TasksPage({ myTasksOnly = false }: { myTasksOnly?: boolean }) {
  const { isAdmin, user, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const assigneeFilter = searchParams.get("assignee") || "all";
  const [createOpen, setCreateOpen] = useState(() => sessionStorage.getItem(TASK_CREATE_OPEN_KEY) === "1");
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [viewMode, setViewMode] = useState<"board" | "list">("board");

  // Drag-and-drop state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    sessionStorage.setItem(TASK_CREATE_OPEN_KEY, createOpen ? "1" : "0");
  }, [createOpen]);

  const canCreateTasks = !myTasksOnly && (profile?.role === "admin" || profile?.role === "manager");
  const showAllTasks = isAdmin && !myTasksOnly;

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", showAllTasks, user?.id, myTasksOnly],
    queryFn: async () => {
      if (showAllTasks) {
        const { data } = await supabase
          .from("tasks")
          .select("*, assigner:profiles!tasks_assigned_by_fkey(full_name), task_assignees(user_id, user:profiles(id, full_name, avatar_url, email))")
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
        .select("*, assigner:profiles!tasks_assigned_by_fkey(full_name), task_assignees(user_id, user:profiles(id, full_name, avatar_url, email))")
        .in("id", taskIds)
        .order("created_at", { ascending: false });
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
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (assigneeFilter !== "all") {
      const assignees = t.task_assignees?.map((a: any) => a.user_id) ?? [];
      if (!assignees.includes(assigneeFilter)) return false;
    }
    return true;
  });

  const setAssignee = (val: string) => {
    const params = new URLSearchParams(searchParams);
    if (val === "all") params.delete("assignee");
    else params.set("assignee", val);
    setSearchParams(params);
  };

  const activeFilters: { label: string; value: string; clear: () => void }[] = [];
  if (priorityFilter !== "all") activeFilters.push({ label: "Priority", value: priorityFilter, clear: () => setPriorityFilter("all") });
  if (assigneeFilter !== "all") {
    const member = members.find((m: any) => m.id === assigneeFilter);
    activeFilters.push({ label: "Assignee", value: member?.full_name ?? "Unknown", clear: () => setAssignee("all") });
  }

  const clearAll = () => { setSearch(""); setPriorityFilter("all"); setAssignee("all"); };
  const getAssignees = (task: any) => task.task_assignees?.map((a: any) => a.user) ?? [];
  const handleOpenCreate = () => setCreateOpen(true);
  const handleCloseCreate = () => setCreateOpen(false);

  const tasksByStatus = COLUMNS.reduce((acc, col) => {
    acc[col.key] = filteredTasks.filter((t: any) => (t.status ?? "todo") === col.key);
    return acc;
  }, {} as Record<string, any[]>);

  const handleTaskDrop = async (targetStatus: string) => {
    if (!draggedTaskId) return;
    const task = tasks.find((t: any) => t.id === draggedTaskId);
    if (!task || task.status === targetStatus) {
      setDraggedTaskId(null);
      return;
    }
    // Optimistic update
    queryClient.setQueryData(
      ["tasks", showAllTasks, user?.id, myTasksOnly],
      (old: any[]) => old.map((t: any) => t.id === draggedTaskId ? { ...t, status: targetStatus } : t)
    );
    setDraggedTaskId(null);
    const { error } = await supabase.from("tasks").update({ status: targetStatus }).eq("id", draggedTaskId);
    if (error) {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.error("Failed to update task status");
    }
  };

  const pageTitle = myTasksOnly ? "My Tasks" : canCreateTasks ? "Tasks" : "My Tasks";

  return (
    <AnimatedPage>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">{pageTitle}</h1>
        <div className="flex items-center gap-2">
          {/* Board / List toggle */}
          <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-card">
            <button
              onClick={() => setViewMode("board")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "board" ? "bg-primary text-white" : "text-ink-secondary hover:bg-muted"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "list" ? "bg-primary text-white" : "text-ink-secondary hover:bg-muted"
              }`}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
          </div>
          {canCreateTasks && (
            <Button onClick={handleOpenCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Create Task
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..." className="pl-9 h-10" />
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin && !myTasksOnly && (
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

      {/* Content */}
      {isLoading ? (
        <div className={viewMode === "board" ? "grid grid-cols-2 xl:grid-cols-4 gap-4" : "space-y-3"}>
          {Array.from({ length: viewMode === "board" ? 4 : 5 }).map((_, i) => (
            <div key={i} className="h-40 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks yet"
          description={canCreateTasks ? "Create your first task to get started." : "You don't have any tasks assigned yet."}
          actionLabel={canCreateTasks ? "Create Task" : undefined}
          onAction={canCreateTasks ? handleOpenCreate : undefined}
        />
      ) : viewMode === "board" ? (
        /* ─── BOARD VIEW ─── */
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {COLUMNS.map((col) => {
            const colTasks = tasksByStatus[col.key] ?? [];
            const isDragTarget = dragOverCol === col.key;
            return (
              <div
                key={col.key}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null);
                }}
                onDrop={() => { handleTaskDrop(col.key); setDragOverCol(null); }}
                className={`rounded-xl border-2 flex flex-col overflow-hidden transition-colors ${
                  isDragTarget ? "border-primary bg-accent-light/40" : "border-border bg-muted/30"
                }`}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
                    <span className="text-sm font-semibold text-ink-primary">{col.label}</span>
                  </div>
                  <span className="text-xs font-medium text-ink-muted bg-muted px-2 py-0.5 rounded-pill">
                    {colTasks.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 p-3 min-h-[100px]">
                  {colTasks.length === 0 && (
                    <p className={`text-xs text-center py-6 transition-colors ${isDragTarget ? "text-primary font-medium" : "text-ink-muted"}`}>
                      {isDragTarget ? "Drop here" : "No tasks"}
                    </p>
                  )}
                  {colTasks.map((task: any) => {
                    const assignees = getAssignees(task);
                    const primaryAssignee = assignees[0];
                    const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== "completed";
                    const isDragging = draggedTaskId === task.id;
                    return (
                      <motion.div
                        key={task.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        draggable
                        onDragStart={() => setDraggedTaskId(task.id)}
                        onDragEnd={() => setDraggedTaskId(null)}
                        onClick={() => setSelectedTask(task)}
                        className={`rounded-lg bg-card border border-border p-3 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/30 transition-all select-none ${
                          isDragging ? "opacity-40 scale-95" : ""
                        }`}
                      >
                        {/* Title */}
                        <p className="text-sm font-semibold text-ink-primary mb-2 leading-snug line-clamp-2">{task.title}</p>

                        {/* Assignees */}
                        {assignees.length > 0 && (
                          <div className="flex items-center gap-1.5 mb-2">
                            <div className="flex -space-x-1.5">
                              {assignees.slice(0, 3).map((a: any) => (
                                <div key={a?.id} className="ring-1 ring-card rounded-full">
                                  <UserAvatar name={a?.full_name ?? "?"} avatarUrl={a?.avatar_url} size="sm" />
                                </div>
                              ))}
                            </div>
                            <span className="text-[11px] text-ink-muted truncate">
                              {assignees.length === 1
                                ? primaryAssignee?.full_name
                                : `${primaryAssignee?.full_name} +${assignees.length - 1}`}
                            </span>
                          </div>
                        )}

                        {/* Footer: priority + deadline */}
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <PriorityBadge priority={task.priority ?? "medium"} />
                          {task.deadline && (
                            <span className={`text-[11px] font-medium ${isOverdue ? "text-destructive" : "text-ink-muted"}`}>
                              {format(new Date(task.deadline), "MMM d")}
                            </span>
                          )}
                        </div>

                        {/* Progress bar */}
                        {(task.progress ?? 0) > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${task.progress ?? 0}%` }}
                                transition={{ duration: 0.6 }}
                                className="h-full rounded-full bg-primary"
                              />
                            </div>
                            <span className="text-[10px] text-ink-muted">{task.progress ?? 0}%</span>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>

                {/* Add card button (admin only) */}
                {canCreateTasks && (
                  <button
                    onClick={handleOpenCreate}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs text-ink-muted hover:text-primary hover:bg-muted/50 transition-colors border-t border-border"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add a Card
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ─── LIST VIEW ─── */
        filteredTasks.length === 0 ? (
          <EmptyState icon={Search} title="No matching tasks" description="Try adjusting your filters." />
        ) : (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
            {filteredTasks.map((task: any) => {
              const assignees = getAssignees(task);
              const primaryAssignee = assignees[0];
              return (
                <motion.div
                  key={task.id}
                  variants={staggerItem}
                  whileHover={{ scale: 1.002 }}
                  onClick={() => setSelectedTask(task)}
                  className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card cursor-pointer hover:shadow-card-hover transition-shadow"
                >
                  <div className="hidden sm:flex items-center -space-x-2">
                    {assignees.slice(0, 3).map((a: any) => (
                      <div key={a?.id} className="ring-2 ring-card rounded-full">
                        <UserAvatar name={a?.full_name ?? "?"} avatarUrl={a?.avatar_url} size="sm" />
                      </div>
                    ))}
                    {assignees.length > 3 && (
                      <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-ink-muted ring-2 ring-card">
                        +{assignees.length - 3}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-primary truncate">{task.title}</p>
                    <p className="text-xs text-ink-muted">
                      {assignees.length === 1 ? primaryAssignee?.full_name : `${primaryAssignee?.full_name} +${assignees.length - 1} more`}
                    </p>
                  </div>
                  <PriorityBadge priority={task.priority ?? "medium"} />
                  <StatusBadge status={task.status ?? "todo"} />
                  <div className="hidden md:flex items-center gap-2 text-xs text-ink-muted w-24">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${task.progress ?? 0}%` }} transition={{ duration: 0.6 }} className="h-full rounded-full bg-primary" />
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
              );
            })}
          </motion.div>
        )
      )}

      <CreateTaskModal open={createOpen} onClose={handleCloseCreate} />
      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
    </AnimatedPage>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
import { Search } from "lucide-react";
