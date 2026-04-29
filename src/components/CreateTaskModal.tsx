import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Paperclip, Trash2, FolderKanban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import UserAvatar from "@/components/UserAvatar";
import { toast } from "sonner";
import { format } from "date-fns";

const TASK_DRAFT_KEY = "tasks:create-draft";
const today = () => format(new Date(), "yyyy-MM-dd");

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  assigned_to: z.array(z.string()).min(1, "At least one assignee is required"),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(["todo", "in_progress", "on_hold", "completed"]),
  deadline: z.string().min(1, "Deadline is required").refine(
    (d) => d >= today(),
    "Deadline must be today or a future date"
  ),
  category: z.string().max(50).optional(),
  project_id: z.string().optional(),
  project_team_id: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

type Props = {
  open: boolean;
  onClose: () => void;
  preselectedAssignee?: string;
};

const getInitialDraft = (preselectedAssignee?: string): FormData => {
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(TASK_DRAFT_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<FormData>;
        return {
          title: parsed.title ?? "",
          description: parsed.description ?? "",
          assigned_to: Array.isArray(parsed.assigned_to)
            ? parsed.assigned_to
            : preselectedAssignee
              ? [preselectedAssignee]
              : [],
          priority: parsed.priority ?? "medium",
          status: parsed.status ?? "todo",
          deadline: parsed.deadline ?? "",
          category: parsed.category ?? "",
          project_id: parsed.project_id ?? "",
          project_team_id: parsed.project_team_id ?? "",
        };
      } catch {
        sessionStorage.removeItem(TASK_DRAFT_KEY);
      }
    }
  }

  return {
    title: "",
    description: "",
    assigned_to: preselectedAssignee ? [preselectedAssignee] : [],
    priority: "medium",
    status: "todo",
    deadline: "",
    category: "",
    project_id: "",
    project_team_id: "",
  };
};

export default function CreateTaskModal({ open, onClose, preselectedAssignee }: Props) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialDraft = useMemo(() => getInitialDraft(preselectedAssignee), [preselectedAssignee]);

  // Managers can only assign tasks to their own team. Admins still see everyone.
  const isManagerRole = profile?.role === "manager";

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-list", isManagerRole ? `team:${user?.id}` : "all"],
    queryFn: async () => {
      let q = supabase.from("profiles").select("id, full_name, avatar_url").eq("is_active", true);
      if (isManagerRole && user?.id) q = q.eq("manager_id", user.id);
      const { data } = await q;
      return data ?? [];
    },
    enabled: open,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, color").eq("status", "active").order("name");
      return data ?? [];
    },
    enabled: open,
  });

  const { data: projectTeams = [] } = useQuery({
    queryKey: ["project-teams"],
    queryFn: async () => {
      const { data } = await supabase.from("project_teams").select("id, project_id, name").order("name");
      return data ?? [];
    },
    enabled: open,
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: initialDraft,
  });

  const draft = watch();
  const selectedAssignees = draft.assigned_to || [];
  const selectedProjectId = draft.project_id;
  const teamsForProject = projectTeams.filter((t: any) => t.project_id === selectedProjectId);

  useEffect(() => {
    if (!open) return;
    reset(getInitialDraft(preselectedAssignee));
  }, [open, preselectedAssignee, reset]);

  useEffect(() => {
    if (!open) return;
    sessionStorage.setItem(TASK_DRAFT_KEY, JSON.stringify(draft));
  }, [draft, open]);

  // Reset team when project changes
  useEffect(() => {
    setValue("project_team_id", "");
  }, [selectedProjectId, setValue]);

  const clearDraft = () => {
    sessionStorage.removeItem(TASK_DRAFT_KEY);
    setAttachedFiles([]);
    reset({
      title: "",
      description: "",
      assigned_to: preselectedAssignee ? [preselectedAssignee] : [],
      priority: "medium",
      status: "todo",
      deadline: "",
      category: "",
      project_id: "",
      project_team_id: "",
    });
  };

  const handleClose = () => {
    setAssigneeDropdownOpen(false);
    setAssigneeSearch("");
    onClose();
  };

  const toggleAssignee = (id: string) => {
    const current = selectedAssignees;
    if (current.includes(id)) {
      setValue("assigned_to", current.filter((a) => a !== id), { shouldValidate: true, shouldDirty: true });
    } else {
      setValue("assigned_to", [...current, id], { shouldValidate: true, shouldDirty: true });
    }
  };

  const createTask = useMutation({
    mutationFn: async (data: FormData) => {
      const { data: taskData, error } = await supabase.from("tasks").insert([{
        title: data.title,
        description: data.description || null,
        assigned_to: data.assigned_to[0],
        priority: data.priority,
        status: data.status,
        deadline: data.deadline,
        category: data.category || null,
        assigned_by: user!.id,
        project_id: data.project_id || null,
        project_team_id: data.project_team_id || null,
      }]).select("id").single();
      if (error) throw error;

      const assigneeRows = data.assigned_to.map((userId) => ({
        task_id: taskData.id,
        user_id: userId,
      }));
      const { error: assignError } = await supabase.from("task_assignees").insert(assigneeRows);
      if (assignError) throw assignError;

      // Notifications are handled by the DB trigger (notify_task_assigned) — no manual insert needed.

      for (const file of attachedFiles) {
        const filePath = `${taskData.id}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage.from("task-attachments").upload(filePath, file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("task-attachments").getPublicUrl(filePath);
        await supabase.from("task_attachments").insert({
          task_id: taskData.id,
          file_name: file.name,
          file_size: file.size,
          file_url: urlData.publicUrl,
          uploaded_by: user!.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["admin-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["manager-my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["users-task-counts"] });
      clearDraft();
      toast.success("Task created successfully");
      handleClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const priorities = ["low", "medium", "high"] as const;
  const priorityColors = {
    low: "bg-success-light text-success border-success/20",
    medium: "bg-warning-light text-warning border-warning/20",
    high: "bg-destructive-light text-destructive border-destructive/20",
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-ink-primary/30" onClick={handleClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-modal bg-card p-6 shadow-modal mx-4"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-heading text-xl font-bold text-ink-primary">Create Task</h2>
              <button onClick={handleClose} className="text-ink-muted hover:text-ink-primary"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={handleSubmit((formData) => createTask.mutate(formData))} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Title *</label>
                <Input {...register("title")} autoFocus className="h-10" />
                {errors.title && <p className="mt-1 text-xs text-destructive">{errors.title.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Description</label>
                <Textarea {...register("description")} rows={3} />
              </div>

              {/* Project assignment */}
              {projects.length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-primary">
                      <FolderKanban className="h-3.5 w-3.5 text-ink-muted" /> Project
                    </label>
                    <Select
                      value={draft.project_id || "none"}
                      onValueChange={(v) => setValue("project_id", v === "none" ? "" : v, { shouldDirty: true })}
                    >
                      <SelectTrigger className="h-10"><SelectValue placeholder="No project" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No project</SelectItem>
                        {projects.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                              {p.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedProjectId && teamsForProject.length > 0 && (
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-ink-primary">Team</label>
                      <Select
                        value={draft.project_team_id || "none"}
                        onValueChange={(v) => setValue("project_team_id", v === "none" ? "" : v, { shouldDirty: true })}
                      >
                        <SelectTrigger className="h-10"><SelectValue placeholder="No team" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No team</SelectItem>
                          {teamsForProject.map((t: any) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Assign To * <span className="text-ink-muted font-normal">(select multiple)</span></label>
                <div className="relative">
                  {/* Selected tags + trigger */}
                  <div
                    className="flex w-full flex-wrap items-center min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm gap-1 cursor-text"
                    onClick={() => setAssigneeDropdownOpen(true)}
                  >
                    {selectedAssignees.map((id) => {
                      const emp = employees.find((employee: any) => employee.id === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-pill bg-accent-light text-primary px-2 py-0.5 text-xs font-medium">
                          {emp?.full_name ?? "Unknown"}
                          <button type="button" onClick={(event) => { event.stopPropagation(); toggleAssignee(id); }}>
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                    <input
                      type="text"
                      value={assigneeSearch}
                      onChange={(e) => { setAssigneeSearch(e.target.value); setAssigneeDropdownOpen(true); }}
                      onFocus={() => setAssigneeDropdownOpen(true)}
                      placeholder={selectedAssignees.length === 0 ? "Type to search members..." : ""}
                      className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-ink-primary placeholder:text-muted-foreground"
                    />
                  </div>
                  {assigneeDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-[200px] overflow-y-auto">
                      {employees
                        .filter((emp: any) => emp.full_name.toLowerCase().includes(assigneeSearch.toLowerCase()))
                        .map((emp: any) => {
                          const selected = selectedAssignees.includes(emp.id);
                          return (
                            <button
                              key={emp.id}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); toggleAssignee(emp.id); setAssigneeSearch(""); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                            >
                              <div className={`h-4 w-4 rounded border flex items-center justify-center ${selected ? "bg-primary border-primary" : "border-border"}`}>
                                {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                              </div>
                              <UserAvatar name={emp.full_name} avatarUrl={emp.avatar_url} size="sm" />
                              <span className="text-ink-primary">{emp.full_name}</span>
                            </button>
                          );
                        })}
                      {employees.filter((emp: any) => emp.full_name.toLowerCase().includes(assigneeSearch.toLowerCase())).length === 0 && (
                        <p className="px-3 py-2 text-sm text-ink-muted">No members found</p>
                      )}
                    </div>
                  )}
                  {/* Click-outside handler */}
                  {assigneeDropdownOpen && (
                    <div className="fixed inset-0 z-40" onClick={() => { setAssigneeDropdownOpen(false); setAssigneeSearch(""); }} />
                  )}
                </div>
                {errors.assigned_to && <p className="mt-1 text-xs text-destructive">{errors.assigned_to.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Priority *</label>
                <div className="flex gap-2">
                  {priorities.map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      onClick={() => setValue("priority", priority, { shouldDirty: true })}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition-all ${draft.priority === priority ? `${priorityColors[priority]} border-current` : "border-border text-ink-secondary hover:bg-muted"}`}
                    >
                      {priority}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Status</label>
                  <Select onValueChange={(value: FormData["status"]) => setValue("status", value, { shouldDirty: true })} value={draft.status}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">To Do</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="on_hold">On Hold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Deadline *</label>
                  <Input {...register("deadline")} type="date" min={today()} className="h-10" />
                  {errors.deadline && <p className="mt-1 text-xs text-destructive">{errors.deadline.message}</p>}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Category</label>
                <Input {...register("category")} placeholder="e.g. Design, Development" className="h-10" />
              </div>

              {/* Attachments */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Attachments</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      setAttachedFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                    }
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5"
                >
                  <Paperclip className="h-4 w-4" />
                  Attach Files
                </Button>
                {attachedFiles.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {attachedFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-1.5 text-sm">
                        <span className="truncate text-ink-secondary">{file.name} <span className="text-ink-muted text-xs">({(file.size / 1024).toFixed(1)} KB)</span></span>
                        <button type="button" onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))} className="text-ink-muted hover:text-destructive ml-2">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={handleClose} className="flex-1">Cancel</Button>
                <Button type="submit" disabled={createTask.isPending} className="flex-1">
                  {createTask.isPending ? "Creating..." : "Create Task"}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
