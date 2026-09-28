import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { CheckCircle2, Search, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import UserAvatar from "@/components/UserAvatar";
import PriorityBadge from "@/components/PriorityBadge";
import EmptyState from "@/components/EmptyState";
import { Input } from "@/components/ui/input";
import TaskDetailModal from "@/components/TaskDetailModal";

export default function CompletedTasksPage() {
  const { user, profile, isAdmin } = useAuth();
  const isStrictAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const isManagerRole = profile?.role === "manager";
  const [search, setSearch] = useState("");
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["completed-tasks", user?.id, isStrictAdmin, isManagerRole],
    queryFn: async () => {
      if (isStrictAdmin) {
        const { data } = await supabase
          .from("tasks")
          .select("*, assigner:profiles!tasks_assigned_by_fkey(full_name), task_assignees(user_id, user:profiles(id, full_name, avatar_url, email))")
          .eq("status", "completed")
          .order("updated_at", { ascending: false });
        return data ?? [];
      }
      if (isManagerRole) {
        const { data: teamRows } = await supabase
          .from("profiles")
          .select("id")
          .eq("manager_id", user!.id);
        const teamIds = [user!.id, ...((teamRows ?? []).map((r: any) => r.id))];
        const { data: assigneeRows } = await supabase
          .from("task_assignees")
          .select("task_id")
          .in("user_id", teamIds);
        const ids = Array.from(new Set((assigneeRows ?? []).map((a: any) => a.task_id)));
        if (!ids.length) return [];
        const { data } = await supabase
          .from("tasks")
          .select("*, assigner:profiles!tasks_assigned_by_fkey(full_name), task_assignees(user_id, user:profiles(id, full_name, avatar_url, email))")
          .in("id", ids)
          .eq("status", "completed")
          .order("updated_at", { ascending: false });
        return data ?? [];
      }
      // Employee / intern: own completed tasks
      const { data: assigned } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("user_id", user!.id);
      const ids = (assigned ?? []).map((a: any) => a.task_id);
      if (!ids.length) return [];
      const { data } = await supabase
        .from("tasks")
        .select("*, assigner:profiles!tasks_assigned_by_fkey(full_name), task_assignees(user_id, user:profiles(id, full_name, avatar_url, email))")
        .in("id", ids)
        .eq("status", "completed")
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  // Only show tasks completed MORE than 7 days ago (archived from board)
  const sevenDaysAgo = useMemo(() => Date.now() - 7 * 24 * 60 * 60 * 1000, []);
  const archivedTasks = useMemo(
    () =>
      tasks.filter((t: any) => {
        const ts = t.updated_at ? new Date(t.updated_at).getTime() : 0;
        return ts > 0 && ts < sevenDaysAgo;
      }),
    [tasks, sevenDaysAgo]
  );

  const filtered = archivedTasks.filter((t: any) =>
    !search || t.title.toLowerCase().includes(search.toLowerCase())
  );

  // Admin/manager → group by assignee
  const groupedByUser = useMemo(() => {
    if (!isAdmin) return null;
    const groups = new Map<string, { user: any; tasks: any[] }>();
    for (const t of filtered) {
      const assignees = t.task_assignees ?? [];
      if (!assignees.length) {
        const g = groups.get("__unassigned__") ?? { user: { id: "__unassigned__", full_name: "Unassigned" }, tasks: [] };
        g.tasks.push(t);
        groups.set("__unassigned__", g);
        continue;
      }
      for (const a of assignees) {
        const u = a.user;
        if (!u) continue;
        const g = groups.get(u.id) ?? { user: u, tasks: [] };
        g.tasks.push(t);
        groups.set(u.id, g);
      }
    }
    return Array.from(groups.values()).sort((a, b) =>
      (a.user.full_name ?? "").localeCompare(b.user.full_name ?? "")
    );
  }, [filtered, isAdmin]);

  const total = filtered.length;

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl sm:text-[28px] font-bold text-ink-primary">Completed Tasks</h1>
          <p className="text-sm text-ink-muted mt-1">
            {isAdmin
              ? "Tasks completed more than a week ago, grouped by team member."
              : "Your tasks completed more than a week ago."}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-success-light px-3 py-1.5">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="text-sm font-semibold text-success">{total} archived</span>
        </div>
      </div>

      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
        <Input
          placeholder="Search completed tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-ink-muted">Loading…</p>
      ) : total === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No archived completed tasks yet"
          description="Tasks marked completed will move here automatically one week after completion."
        />
      ) : isAdmin && groupedByUser ? (
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-4">
          {groupedByUser.map((g) => {
            const isCollapsed = collapsed[g.user.id];
            return (
              <motion.div key={g.user.id} variants={staggerItem} className="rounded-card bg-card shadow-card overflow-hidden">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [g.user.id]: !c[g.user.id] }))}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/50 transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-ink-muted" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-ink-muted" />
                  )}
                  <UserAvatar name={g.user.full_name ?? "?"} avatarUrl={g.user.avatar_url} size="sm" />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-primary truncate">{g.user.full_name}</p>
                    {g.user.email && <p className="text-xs text-ink-muted truncate">{g.user.email}</p>}
                  </div>
                  <span className="rounded-full bg-success-light px-2.5 py-0.5 text-xs font-semibold text-success">
                    {g.tasks.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="border-t border-border divide-y divide-border">
                    {g.tasks.map((t: any) => (
                      <button
                        key={`${g.user.id}-${t.id}`}
                        onClick={() => setSelectedTask(t)}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors text-left"
                      >
                        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink-primary truncate">{t.title}</p>
                          <p className="text-xs text-ink-muted">
                            Completed {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                            {t.deadline && ` · was due ${format(new Date(t.deadline), "MMM d")}`}
                          </p>
                        </div>
                        <PriorityBadge priority={t.priority ?? "medium"} />
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      ) : (
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="rounded-card bg-card shadow-card divide-y divide-border">
          {filtered.map((t: any) => (
            <motion.button
              key={t.id}
              variants={staggerItem}
              onClick={() => setSelectedTask(t)}
              className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors text-left"
            >
              <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-primary truncate">{t.title}</p>
                <p className="text-xs text-ink-muted">
                  Completed {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true })}
                  {t.deadline && ` · was due ${format(new Date(t.deadline), "MMM d")}`}
                </p>
              </div>
              <PriorityBadge priority={t.priority ?? "medium"} />
            </motion.button>
          ))}
        </motion.div>
      )}

      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
    </AnimatedPage>
  );
}
