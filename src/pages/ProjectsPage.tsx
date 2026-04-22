import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, X, ChevronDown, ChevronRight, FolderKanban,
  MoreVertical, Pencil, Trash2, UserPlus, GripVertical, Check,
  CheckSquare, ArrowLeft,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import UserAvatar from "@/components/UserAvatar";
import PriorityBadge from "@/components/PriorityBadge";
import StatusBadge from "@/components/StatusBadge";
import TaskDetailModal from "@/components/TaskDetailModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────
type Project = {
  id: string; name: string; description: string | null;
  color: string; status: string; created_at: string;
};
type ProjectTeam = { id: string; project_id: string; name: string };
type ProjectMember = {
  id: string; project_id: string; team_id: string | null;
  user_id: string; role: string; sort_order: number;
  user: { id: string; full_name: string; avatar_url: string | null; email: string; role: string };
};
type Profile = { id: string; full_name: string; avatar_url: string | null; email: string; role: string };

// ─── Colour palette ──────────────────────────────────────────────────────────
const PROJECT_COLORS = [
  "#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981",
  "#3b82f6","#ef4444","#14b8a6","#f97316","#84cc16",
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: teams = [] } = useQuery<ProjectTeam[]>({
    queryKey: ["project-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_teams").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: members = [] } = useQuery<ProjectMember[]>({
    queryKey: ["project-members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_members")
        .select("*, user:profiles(id, full_name, avatar_url, email, role)")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as ProjectMember[];
    },
  });

  const { data: allProfiles = [] } = useQuery<Profile[]>({
    queryKey: ["all-profiles-projects"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles").select("id, full_name, avatar_url, email, role")
        .eq("is_active", true).order("full_name");
      return data ?? [];
    },
  });

  const deleteProject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Project deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleExpand = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-[28px] font-bold text-ink-primary">Projects</h1>
          <p className="text-sm text-ink-muted">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New Project
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FolderKanban className="h-12 w-12 text-ink-muted mb-4" />
          <p className="font-heading text-lg font-semibold text-ink-primary">No projects yet</p>
          <p className="text-sm text-ink-muted mb-4">Create your first project to organise your teams and tasks.</p>
          {isAdmin && <Button onClick={() => setCreateOpen(true)}>Create Project</Button>}
        </div>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => {
            const projectTeams = teams.filter((t) => t.project_id === project.id);
            const projectMembers = members.filter((m) => m.project_id === project.id);
            const isExpanded = expandedProjects.has(project.id);

            return (
              <ProjectCard
                key={project.id}
                project={project}
                projectTeams={projectTeams}
                projectMembers={projectMembers}
                allProfiles={allProfiles}
                isAdmin={isAdmin}
                isExpanded={isExpanded}
                currentUserId={user?.id ?? ""}
                onToggle={() => toggleExpand(project.id)}
                onEdit={() => setEditProject(project)}
                onDelete={() => {
                  if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
                    deleteProject.mutate(project.id);
                  }
                }}
              />
            );
          })}
        </div>
      )}

      {isAdmin && (
        <ProjectFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
      {isAdmin && editProject && (
        <ProjectFormModal open={!!editProject} project={editProject} onClose={() => setEditProject(null)} />
      )}
    </AnimatedPage>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────
function ProjectCard({
  project, projectTeams, projectMembers, allProfiles,
  isAdmin, isExpanded, currentUserId, onToggle, onEdit, onDelete,
}: {
  project: Project;
  projectTeams: ProjectTeam[];
  projectMembers: ProjectMember[];
  allProfiles: Profile[];
  isAdmin: boolean;
  isExpanded: boolean;
  currentUserId: string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<string | null>(null);
  const [draggedMemberId, setDraggedMemberId] = useState<string | null>(null);
  const [dragOverTeam, setDragOverTeam] = useState<string | null>(null);
  const [activeTeam, setActiveTeam] = useState<ProjectTeam | null>(null);
  const [adminActiveTeam, setAdminActiveTeam] = useState<ProjectTeam | null>(null);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const qc = useQueryClient();

  const membersWithoutTeam = projectMembers.filter((m) => !m.team_id);

  const { data: myTeamTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ["my-team-tasks", project.id, currentUserId, activeTeam?.id ?? null],
    queryFn: async () => {
      const { data: assignedIds } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("user_id", currentUserId);
      if (!assignedIds?.length) return [];
      const taskIds = assignedIds.map((a: any) => a.task_id);
      let q = supabase
        .from("tasks")
        .select("*, task_assignees(user_id, user:profiles(id, full_name, avatar_url))")
        .in("id", taskIds)
        .eq("project_id", project.id)
        .order("created_at", { ascending: false });
      if (activeTeam?.id) q = q.eq("project_team_id", activeTeam.id);
      const { data } = await q;
      return data ?? [];
    },
    enabled: !isAdmin && !!currentUserId && isExpanded,
  });

  const { data: adminTeamTasks = [], isLoading: adminTasksLoading } = useQuery({
    queryKey: ["admin-team-tasks", project.id, adminActiveTeam?.id],
    queryFn: async () => {
      let q = supabase
        .from("tasks")
        .select("*, task_assignees(user_id, user:profiles(id, full_name, avatar_url))")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false });
      if (adminActiveTeam?.id) q = q.eq("project_team_id", adminActiveTeam.id);
      const { data } = await q;
      return data ?? [];
    },
    enabled: isAdmin && !!adminActiveTeam,
  });

  const deleteTeam = useMutation({
    mutationFn: async (teamId: string) => {
      await supabase.from("project_members").update({ team_id: null }).eq("team_id", teamId);
      const { error } = await supabase.from("project_teams").delete().eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-teams"] });
      qc.invalidateQueries({ queryKey: ["project-members"] });
      toast.success("Team removed");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from("project_members").delete().eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-members"] }); toast.success("Member removed"); },
    onError: (e: any) => toast.error(e.message),
  });

  const moveMember = useMutation({
    mutationFn: async ({ memberId, teamId }: { memberId: string; teamId: string | null }) => {
      const { error } = await supabase
        .from("project_members").update({ team_id: teamId }).eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-members"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleDrop = (teamId: string | null) => {
    if (!draggedMemberId) return;
    moveMember.mutate({ memberId: draggedMemberId, teamId });
    setDraggedMemberId(null);
    setDragOverTeam(null);
  };

  const isMemberOfProject = projectMembers.some((m) => m.user_id === currentUserId);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Project Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: project.color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-base font-bold text-ink-primary">{project.name}</h2>
            <span className="text-xs text-ink-muted bg-muted px-2 py-0.5 rounded-pill">
              {projectMembers.length} member{projectMembers.length !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-ink-muted bg-muted px-2 py-0.5 rounded-pill">
              {projectTeams.length} team{projectTeams.length !== 1 ? "s" : ""}
            </span>
          </div>
          {project.description && (
            <p className="text-xs text-ink-muted truncate mt-0.5">{project.description}</p>
          )}
        </div>

        {/* Avatar stack */}
        <div className="flex -space-x-2 mr-2">
          {projectMembers.slice(0, 5).map((m) => (
            <div key={m.id} className="ring-2 ring-card rounded-full">
              <UserAvatar name={m.user?.full_name ?? ""} avatarUrl={m.user?.avatar_url} size="sm" />
            </div>
          ))}
          {projectMembers.length > 5 && (
            <div className="h-7 w-7 rounded-full bg-muted ring-2 ring-card flex items-center justify-center text-[10px] font-medium text-ink-muted">
              +{projectMembers.length - 5}
            </div>
          )}
        </div>

        {isAdmin && (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-ink-muted hover:text-ink-primary p-1 rounded">
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-2" />Edit Project</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddTeamOpen(true)}><Plus className="h-3.5 w-3.5 mr-2" />Add Team</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5 mr-2" />Delete Project</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {isExpanded ? <ChevronDown className="h-4 w-4 text-ink-muted flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-ink-muted flex-shrink-0" />}
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-5 py-4">

              {/* ── ADMIN VIEW ── */}
              {isAdmin ? (
                <>
                  {adminActiveTeam ? (
                    /* ── Admin: task view for selected team ── */
                    <div>
                      <button
                        onClick={() => setAdminActiveTeam(null)}
                        className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary mb-4 transition-colors"
                      >
                        <ArrowLeft className="h-4 w-4" /> Back to team management
                      </button>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />
                        <h3 className="font-heading text-base font-semibold text-ink-primary">{adminActiveTeam.name}</h3>
                        <span className="text-xs text-ink-muted bg-muted px-2 py-0.5 rounded-pill">All Tasks</span>
                      </div>

                      {adminTasksLoading ? (
                        <div className="space-y-2">
                          {[1,2,3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
                        </div>
                      ) : adminTeamTasks.length === 0 ? (
                        <div className="flex flex-col items-center py-10 text-center">
                          <CheckSquare className="h-9 w-9 text-ink-muted mb-2" />
                          <p className="text-sm font-medium text-ink-primary">No tasks in this project</p>
                          <p className="text-xs text-ink-muted">Tasks assigned to this project will appear here.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {adminTeamTasks.map((task: any) => {
                            const assignees = task.task_assignees?.map((a: any) => a.user) ?? [];
                            const primaryAssignee = assignees[0];
                            const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== "completed";
                            return (
                              <motion.div
                                key={task.id}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                onClick={() => setSelectedTask(task)}
                                className="flex items-center gap-3 rounded-lg bg-muted/30 border border-border p-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-ink-primary truncate">{task.title}</p>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    {assignees.length > 0 && (
                                      <span className="text-[11px] text-ink-muted">
                                        {assignees.length === 1
                                          ? primaryAssignee?.full_name
                                          : `${primaryAssignee?.full_name} +${assignees.length - 1}`}
                                      </span>
                                    )}
                                    {task.deadline && (
                                      <span className={`text-[11px] ${isOverdue ? "text-destructive font-medium" : "text-ink-muted"}`}>
                                        · Due {format(new Date(task.deadline), "MMM d, yyyy")}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <PriorityBadge priority={task.priority ?? "medium"} />
                                <StatusBadge status={task.status ?? "todo"} />
                                {(task.progress ?? 0) > 0 && (
                                  <div className="hidden sm:flex items-center gap-1.5 w-20">
                                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                                      <div className="h-full rounded-full bg-primary" style={{ width: `${task.progress}%` }} />
                                    </div>
                                    <span className="text-[10px] text-ink-muted">{task.progress}%</span>
                                  </div>
                                )}
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ── Admin: team management + clickable team cards ── */
                    <>
                      {/* Clickable team cards for admin to view tasks */}
                      {projectTeams.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
                          {projectTeams.map((team) => {
                            const teamMembers = projectMembers.filter((m) => m.team_id === team.id);
                            return (
                              <button
                                key={team.id}
                                onClick={() => setAdminActiveTeam(team)}
                                className="text-left rounded-lg border-2 border-primary/20 bg-accent-light/30 p-3 transition-all hover:shadow-md hover:border-primary/50 group"
                              >
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
                                  <span className="text-sm font-semibold text-ink-primary group-hover:text-primary transition-colors">
                                    {team.name}
                                  </span>
                                  <span className="ml-auto text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-pill">
                                    {teamMembers.length} member{teamMembers.length !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="flex -space-x-1.5 mb-1">
                                  {teamMembers.slice(0, 5).map((m) => (
                                    <div key={m.id} className="ring-1 ring-card rounded-full">
                                      <UserAvatar name={m.user?.full_name ?? ""} avatarUrl={m.user?.avatar_url} size="sm" />
                                    </div>
                                  ))}
                                </div>
                                <p className="text-[11px] text-ink-muted group-hover:text-primary transition-colors">
                                  Click to view all tasks →
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Team management grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {projectTeams.map((team) => {
                          const teamMembers = projectMembers.filter((m) => m.team_id === team.id);
                          const isDragTarget = dragOverTeam === team.id;
                          return (
                            <div
                              key={team.id}
                              onDragOver={(e) => { e.preventDefault(); setDragOverTeam(team.id); }}
                              onDragLeave={() => setDragOverTeam(null)}
                              onDrop={() => handleDrop(team.id)}
                              className={`rounded-lg border-2 transition-colors p-3 ${isDragTarget ? "border-primary bg-accent-light" : "border-border bg-muted/20"}`}
                            >
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
                                  <span className="text-sm font-semibold text-ink-primary">{team.name}</span>
                                  <span className="text-xs text-ink-muted">({teamMembers.length})</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setAssignOpen(team.id)}
                                    className="text-ink-muted hover:text-primary p-1 rounded"
                                    title="Add member"
                                  >
                                    <UserPlus className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirm(`Remove team "${team.name}"? Members will become unassigned.`)) {
                                        deleteTeam.mutate(team.id);
                                      }
                                    }}
                                    className="text-ink-muted hover:text-destructive p-1 rounded"
                                    title="Remove team"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="space-y-1.5 min-h-[40px]">
                                {teamMembers.length === 0 && (
                                  <p className="text-xs text-ink-muted text-center py-2">Drop members here</p>
                                )}
                                {teamMembers.map((m) => (
                                  <MemberChip
                                    key={m.id}
                                    member={m}
                                    isAdmin={isAdmin}
                                    onRemove={() => removeMember.mutate(m.id)}
                                    onDragStart={() => setDraggedMemberId(m.id)}
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}

                        {/* Unassigned lane */}
                        {membersWithoutTeam.length > 0 && (
                          <div
                            onDragOver={(e) => { e.preventDefault(); setDragOverTeam("none"); }}
                            onDragLeave={() => setDragOverTeam(null)}
                            onDrop={() => handleDrop(null)}
                            className={`rounded-lg border-2 border-dashed transition-colors p-3 ${dragOverTeam === "none" ? "border-primary bg-accent-light" : "border-border"}`}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-sm font-semibold text-ink-muted">Unassigned</span>
                              <span className="text-xs text-ink-muted">({membersWithoutTeam.length})</span>
                            </div>
                            <div className="space-y-1.5">
                              {membersWithoutTeam.map((m) => (
                                <MemberChip
                                  key={m.id}
                                  member={m}
                                  isAdmin={isAdmin}
                                  onRemove={() => removeMember.mutate(m.id)}
                                  onDragStart={() => setDraggedMemberId(m.id)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-border">
                        <Button size="sm" variant="outline" onClick={() => setAddTeamOpen(true)} className="gap-1.5">
                          <Plus className="h-3.5 w-3.5" /> Add Team
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setAssignOpen("none")} className="gap-1.5">
                          <UserPlus className="h-3.5 w-3.5" /> Assign Member
                        </Button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* ── EMPLOYEE VIEW: clickable team cards → show my tasks ── */
                activeTeam ? (
                  /* Task panel for selected team */
                  <div>
                    <button
                      onClick={() => setActiveTeam(null)}
                      className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary mb-4 transition-colors"
                    >
                      <ArrowLeft className="h-4 w-4" /> Back to teams
                    </button>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />
                      <h3 className="font-heading text-base font-semibold text-ink-primary">{activeTeam.name}</h3>
                      <span className="text-xs text-ink-muted bg-muted px-2 py-0.5 rounded-pill">My Tasks</span>
                    </div>

                    {tasksLoading ? (
                      <div className="space-y-2">
                        {[1,2,3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
                      </div>
                    ) : myTeamTasks.length === 0 ? (
                      <div className="flex flex-col items-center py-10 text-center">
                        <CheckSquare className="h-9 w-9 text-ink-muted mb-2" />
                        <p className="text-sm font-medium text-ink-primary">No tasks assigned</p>
                        <p className="text-xs text-ink-muted">You have no tasks in this project yet.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {myTeamTasks.map((task: any) => {
                          const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== "completed";
                          return (
                            <motion.div
                              key={task.id}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              onClick={() => setSelectedTask(task)}
                              className="flex items-center gap-3 rounded-lg bg-muted/30 border border-border p-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-ink-primary truncate">{task.title}</p>
                                {task.deadline && (
                                  <p className={`text-[11px] mt-0.5 ${isOverdue ? "text-destructive font-medium" : "text-ink-muted"}`}>
                                    Due {format(new Date(task.deadline), "MMM d, yyyy")}
                                  </p>
                                )}
                              </div>
                              <PriorityBadge priority={task.priority ?? "medium"} />
                              <StatusBadge status={task.status ?? "todo"} />
                              {(task.progress ?? 0) > 0 && (
                                <div className="hidden sm:flex items-center gap-1.5 w-20">
                                  <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                                    <div className="h-full rounded-full bg-primary" style={{ width: `${task.progress}%` }} />
                                  </div>
                                  <span className="text-[10px] text-ink-muted">{task.progress}%</span>
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Team cards grid for employees */
                  isMemberOfProject ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      {projectTeams.map((team) => {
                        const teamMembers = projectMembers.filter((m) => m.team_id === team.id);
                        const isMember = teamMembers.some((m) => m.user_id === currentUserId);
                        return isMember ? (
                          /* Clickable — user is in this team */
                          <button
                            key={team.id}
                            onClick={() => setActiveTeam(team)}
                            className="text-left rounded-lg border-2 border-primary/20 bg-accent-light/40 p-4 transition-all hover:shadow-md hover:border-primary/50 group"
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />
                              <span className="text-sm font-semibold text-ink-primary group-hover:text-primary transition-colors">
                                {team.name}
                              </span>
                              <span className="ml-auto text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-pill">
                                You're in this team
                              </span>
                            </div>
                            <div className="flex -space-x-2 mb-3">
                              {teamMembers.slice(0, 5).map((m) => (
                                <div key={m.id} className="ring-2 ring-card rounded-full">
                                  <UserAvatar name={m.user?.full_name ?? ""} avatarUrl={m.user?.avatar_url} size="sm" />
                                </div>
                              ))}
                              {teamMembers.length > 5 && (
                                <div className="h-7 w-7 rounded-full bg-muted ring-2 ring-card flex items-center justify-center text-[10px] font-medium text-ink-muted">
                                  +{teamMembers.length - 5}
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-ink-muted">
                              {teamMembers.length} member{teamMembers.length !== 1 ? "s" : ""} · Click to view your tasks
                            </p>
                          </button>
                        ) : (
                          /* Non-clickable — user is not in this team */
                          <div
                            key={team.id}
                            className="text-left rounded-lg border-2 border-border bg-muted/20 p-4 opacity-50 cursor-not-allowed"
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />
                              <span className="text-sm font-semibold text-ink-primary">{team.name}</span>
                            </div>
                            <div className="flex -space-x-2 mb-3">
                              {teamMembers.slice(0, 5).map((m) => (
                                <div key={m.id} className="ring-2 ring-card rounded-full">
                                  <UserAvatar name={m.user?.full_name ?? ""} avatarUrl={m.user?.avatar_url} size="sm" />
                                </div>
                              ))}
                              {teamMembers.length > 5 && (
                                <div className="h-7 w-7 rounded-full bg-muted ring-2 ring-card flex items-center justify-center text-[10px] font-medium text-ink-muted">
                                  +{teamMembers.length - 5}
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-ink-muted">
                              {teamMembers.length} member{teamMembers.length !== 1 ? "s" : ""} · Not your team
                            </p>
                          </div>
                        );
                      })}
                      {projectTeams.length === 0 && (
                        <p className="text-sm text-ink-muted col-span-3 py-4">No teams in this project yet.</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-8 text-center">
                      <FolderKanban className="h-8 w-8 text-ink-muted mb-2" />
                      <p className="text-sm text-ink-muted">You are not assigned to this project.</p>
                    </div>
                  )
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {addTeamOpen && (
        <AddTeamModal projectId={project.id} onClose={() => setAddTeamOpen(false)} />
      )}
      {assignOpen !== null && (
        <AssignMemberModal
          projectId={project.id}
          teams={projectTeams}
          defaultTeamId={assignOpen === "none" ? null : assignOpen}
          existingMemberIds={projectMembers.map((m) => m.user_id)}
          allProfiles={allProfiles}
          onClose={() => setAssignOpen(null)}
        />
      )}
      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
  );
}

// ─── Member Chip ──────────────────────────────────────────────────────────────
function MemberChip({
  member, isAdmin, onRemove, onDragStart,
}: {
  member: ProjectMember; isAdmin: boolean;
  onRemove: () => void; onDragStart: () => void;
}) {
  return (
    <div
      draggable={isAdmin}
      onDragStart={onDragStart}
      className={`flex items-center gap-2 rounded-md bg-card border border-border px-2 py-1.5 text-sm group ${isAdmin ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {isAdmin && <GripVertical className="h-3.5 w-3.5 text-ink-muted flex-shrink-0" />}
      <UserAvatar name={member.user?.full_name ?? ""} avatarUrl={member.user?.avatar_url} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-ink-primary truncate">{member.user?.full_name}</p>
        <p className="text-[10px] text-ink-muted truncate capitalize">{member.user?.role}</p>
      </div>
      {isAdmin && (
        <button
          onClick={onRemove}
          className="text-ink-muted hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ─── Project Form Modal ───────────────────────────────────────────────────────
function ProjectFormModal({
  open, project, onClose,
}: {
  open: boolean; project?: Project; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Project name is required"); return; }
    setSaving(true);
    try {
      if (project) {
        const { error } = await supabase.from("projects")
          .update({ name: name.trim(), description: description.trim() || null, color, updated_at: new Date().toISOString() })
          .eq("id", project.id);
        if (error) throw error;
        toast.success("Project updated");
      } else {
        const { error } = await supabase.from("projects")
          .insert({ name: name.trim(), description: description.trim() || null, color, created_by: user!.id });
        if (error) throw error;
        toast.success("Project created");
      }
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ display: open ? "flex" : "none" }}>
      <div className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-[460px] rounded-xl bg-card p-6 shadow-xl mx-4"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading text-xl font-bold text-ink-primary">
            {project ? "Edit Project" : "New Project"}
          </h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink-primary"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Project Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VLM, Project Alpha" className="h-10" autoFocus />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of the project..." rows={3} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Colour</label>
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving ? "Saving..." : project ? "Save Changes" : "Create Project"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Add Team Modal ───────────────────────────────────────────────────────────
function AddTeamModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("Team name is required"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("project_teams").insert({ project_id: projectId, name: name.trim() });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["project-teams"] });
      toast.success("Team added");
      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-[360px] rounded-xl bg-card p-6 shadow-xl mx-4"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-lg font-bold text-ink-primary">Add Team</h3>
          <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
        </div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Design, Mechanical, Software"
          className="h-10 mb-4"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="flex-1">
            {saving ? "Adding..." : "Add Team"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Assign Member Modal ──────────────────────────────────────────────────────
function AssignMemberModal({
  projectId, teams, defaultTeamId, existingMemberIds, allProfiles, onClose,
}: {
  projectId: string;
  teams: ProjectTeam[];
  defaultTeamId: string | null;
  existingMemberIds: string[];
  allProfiles: Profile[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [teamId, setTeamId] = useState<string | null>(defaultTeamId);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const available = allProfiles.filter(
    (p) => p.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    setSelectedUsers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleAssign = async () => {
    if (!selectedUsers.length) { toast.error("Select at least one member"); return; }
    setSaving(true);
    try {
      // Find who's already in this exact team to avoid duplicates
      let alreadyInThisTeam: string[] = [];
      if (teamId) {
        const { data: existing } = await supabase
          .from("project_members")
          .select("user_id")
          .eq("project_id", projectId)
          .eq("team_id", teamId)
          .in("user_id", selectedUsers);
        alreadyInThisTeam = (existing ?? []).map((r: any) => r.user_id);
      } else {
        // For "Unassigned", check users already unassigned in this project
        const { data: existing } = await supabase
          .from("project_members")
          .select("user_id")
          .eq("project_id", projectId)
          .is("team_id", null)
          .in("user_id", selectedUsers);
        alreadyInThisTeam = (existing ?? []).map((r: any) => r.user_id);
      }

      const toInsert = selectedUsers.filter((id) => !alreadyInThisTeam.includes(id));
      const duplicateNames = selectedUsers
        .filter((id) => alreadyInThisTeam.includes(id))
        .map((id) => allProfiles.find((p) => p.id === id)?.full_name ?? id);

      if (toInsert.length > 0) {
        const { error } = await supabase.from("project_members").insert(
          toInsert.map((userId) => ({
            project_id: projectId,
            team_id: teamId ?? null,
            user_id: userId,
          }))
        );
        if (error) throw error;
        qc.invalidateQueries({ queryKey: ["project-members"] });
        toast.success(`${toInsert.length} member${toInsert.length > 1 ? "s" : ""} assigned`);
      }
      if (duplicateNames.length > 0) {
        toast.warning(`${duplicateNames.join(", ")} already in this team`);
      }

      onClose();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-[420px] rounded-xl bg-card p-6 shadow-xl mx-4"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-lg font-bold text-ink-primary">Assign Members</h3>
          <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
        </div>

        {teams.length > 0 && (
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Assign to Team</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setTeamId(null)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${teamId === null ? "bg-primary text-white border-primary" : "border-border text-ink-secondary hover:bg-muted"}`}
              >
                Unassigned
              </button>
              {teams.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTeamId(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${teamId === t.id ? "bg-primary text-white border-primary" : "border-border text-ink-secondary hover:bg-muted"}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search members..." className="h-9" autoFocus />
        </div>

        <div className="max-h-[240px] overflow-y-auto space-y-1 mb-4">
          {available.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-4">No members found</p>
          ) : (
            available.map((p) => {
              const selected = selectedUsers.includes(p.id);
              const alreadyInProject = existingMemberIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted transition-colors"
                >
                  <div className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${selected ? "bg-primary border-primary" : "border-border"}`}>
                    {selected && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="sm" />
                  <div className="text-left flex-1">
                    <p className="text-sm font-medium text-ink-primary">{p.full_name}</p>
                    <p className="text-xs text-ink-muted capitalize">{p.role}</p>
                  </div>
                  {alreadyInProject && (
                    <span className="text-[10px] bg-accent-light text-primary px-1.5 py-0.5 rounded-pill font-medium shrink-0">
                      In project
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={handleAssign} disabled={saving || !selectedUsers.length} className="flex-1">
            {saving ? "Assigning..." : `Assign ${selectedUsers.length > 0 ? `(${selectedUsers.length})` : ""}`}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
