import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Download, Trash2, Paperclip, Pencil, Check, ChevronDown } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const today = () => format(new Date(), "yyyy-MM-dd");

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-success-light text-success border-success/20",
  medium: "bg-warning-light text-warning border-warning/20",
  high: "bg-destructive-light text-destructive border-destructive/20",
};

export default function TaskDetailModal({ task, onClose }: { task: any; onClose: () => void }) {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  // Progress / status state (always editable)
  const [progress, setProgress] = useState(task?.progress ?? 0);
  const [status, setStatus] = useState(task?.status ?? "todo");
  const [comment, setComment] = useState("");

  // Edit mode state (admin/manager only)
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState(task?.title ?? "");
  const [editDescription, setEditDescription] = useState(task?.description ?? "");
  const [editPriority, setEditPriority] = useState<"low" | "medium" | "high">(task?.priority ?? "medium");
  const [editDeadline, setEditDeadline] = useState(task?.deadline ?? "");
  const [editCategory, setEditCategory] = useState(task?.category ?? "");
  const [editAssignees, setEditAssignees] = useState<string[]>(
    task?.task_assignees?.map((a: any) => a.user_id) ?? []
  );
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: comments = [] } = useQuery({
    queryKey: ["task-comments", task?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("task_comments")
        .select("*, user:profiles!task_comments_user_id_fkey(full_name, avatar_url)")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!task,
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ["task-attachments", task?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("task_attachments")
        .select("*")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!task,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("is_active", true);
      return data ?? [];
    },
    enabled: editMode && isAdmin,
  });

  const invalidateTasks = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["admin-tasks"] });
  };

  // Save progress/status only
  const updateProgressStatus = useMutation({
    mutationFn: async () => {
      await supabase.from("tasks").update({ progress, status }).eq("id", task.id);
    },
    onSuccess: () => {
      invalidateTasks();
      toast.success("Task updated");
    },
    onError: () => toast.error("Failed to update task"),
  });

  // Save full task details (admin/manager only)
  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!editTitle.trim()) throw new Error("Title is required");
      if (editAssignees.length === 0) throw new Error("At least one assignee is required");

      const { error: taskError } = await supabase
        .from("tasks")
        .update({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          priority: editPriority,
          deadline: editDeadline || null,
          category: editCategory.trim() || null,
          assigned_to: editAssignees[0],
        })
        .eq("id", task.id);
      if (taskError) throw taskError;

      // Sync assignees: delete existing then re-insert
      const { error: delError } = await supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", task.id);
      if (delError) throw delError;

      const { error: insError } = await supabase
        .from("task_assignees")
        .insert(editAssignees.map((uid) => ({ task_id: task.id, user_id: uid })));
      if (insError) throw insError;
    },
    onSuccess: () => {
      invalidateTasks();
      setEditMode(false);
      toast.success("Task saved successfully");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save task"),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      await supabase
        .from("task_comments")
        .insert({ task_id: task.id, user_id: user!.id, body: comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
      setComment("");
      toast.success("Comment added");
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: async (attachment: any) => {
      const url = new URL(attachment.file_url);
      const pathMatch = url.pathname.match(/\/task-attachments\/(.+)$/);
      if (pathMatch) {
        await supabase.storage
          .from("task-attachments")
          .remove([decodeURIComponent(pathMatch[1])]);
      }
      await supabase.from("task_attachments").delete().eq("id", attachment.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-attachments", task?.id] });
      toast.success("Attachment removed");
    },
    onError: () => toast.error("Failed to remove attachment"),
  });

  const uploadAttachment = useMutation({
    mutationFn: async (file: File) => {
      const filePath = `${task.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("task-attachments")
        .upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from("task-attachments")
        .getPublicUrl(filePath);
      await supabase.from("task_attachments").insert({
        task_id: task.id,
        file_name: file.name,
        file_size: file.size,
        file_url: urlData.publicUrl,
        uploaded_by: user!.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-attachments", task?.id] });
      toast.success("File attached");
    },
    onError: () => toast.error("Failed to upload file"),
  });

  const toggleAssignee = (id: string) => {
    setEditAssignees((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  const cancelEdit = () => {
    setEditTitle(task?.title ?? "");
    setEditDescription(task?.description ?? "");
    setEditPriority(task?.priority ?? "medium");
    setEditDeadline(task?.deadline ?? "");
    setEditCategory(task?.category ?? "");
    setEditAssignees(task?.task_assignees?.map((a: any) => a.user_id) ?? []);
    setAssigneeDropdownOpen(false);
    setEditMode(false);
  };

  if (!task) return null;

  const daysLeft = task.deadline
    ? differenceInDays(new Date(task.deadline), new Date())
    : null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-ink-primary/30"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-modal bg-card shadow-modal mx-4"
        >
          {/* Header */}
          <div className="sticky top-0 bg-card z-10 flex items-center justify-between p-5 border-b border-border gap-3">
            {editMode ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="h-9 font-heading text-base font-bold text-ink-primary flex-1"
                autoFocus
                placeholder="Task title"
              />
            ) : (
              <h2 className="font-heading text-lg font-bold text-ink-primary truncate flex-1">
                {task.title}
              </h2>
            )}
            <div className="flex items-center gap-2 shrink-0">
              {isAdmin && !editMode && (
                <button
                  onClick={() => setEditMode(true)}
                  className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-muted"
                >
                  <Pencil className="h-4 w-4" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}
              <button onClick={onClose} className="text-ink-muted hover:text-ink-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-5 gap-6 p-5">
            {/* Left column */}
            <div className="md:col-span-3 space-y-5">
              {/* Badges – view mode only */}
              {!editMode && (
                <div className="flex gap-2 flex-wrap">
                  <StatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                </div>
              )}

              {/* Description */}
              {editMode ? (
                <div>
                  <label className="text-sm font-medium text-ink-primary mb-1.5 block">
                    Description
                  </label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    placeholder="Task description..."
                  />
                </div>
              ) : (
                task.description && (
                  <p className="text-sm text-ink-secondary">{task.description}</p>
                )
              )}

              {/* Priority – edit mode only */}
              {editMode && (
                <div>
                  <label className="text-sm font-medium text-ink-primary mb-1.5 block">
                    Priority
                  </label>
                  <div className="flex gap-2">
                    {(["low", "medium", "high"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setEditPriority(p)}
                        className={`flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition-all ${
                          editPriority === p
                            ? `${PRIORITY_COLORS[p]} border-current`
                            : "border-border text-ink-secondary hover:bg-muted"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Progress & Status – always editable */}
              <div>
                <label className="text-sm font-medium text-ink-primary mb-2 block">
                  Completion —{" "}
                  <span className="text-primary font-heading text-xl">{progress}%</span>
                </label>
                <Slider
                  value={[progress]}
                  onValueChange={([v]) => {
                    setProgress(v);
                    if (v === 100) setStatus("completed");
                  }}
                  max={100}
                  step={5}
                  className="my-3"
                />
                <Select
                  value={status}
                  onValueChange={(v) => {
                    setStatus(v);
                    if (v === "completed") setProgress(100);
                  }}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={() => updateProgressStatus.mutate()}
                  disabled={updateProgressStatus.isPending}
                  className="mt-3"
                >
                  {updateProgressStatus.isPending ? "Saving..." : "Save Progress"}
                </Button>
              </div>

              {/* Edit mode – save / cancel */}
              {editMode && (
                <div className="flex gap-2 pt-1 border-t border-border">
                  <Button
                    onClick={() => saveEdit.mutate()}
                    disabled={saveEdit.isPending}
                    size="sm"
                    className="gap-1.5"
                  >
                    <Check className="h-4 w-4" />
                    {saveEdit.isPending ? "Saving..." : "Save Task"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={cancelEdit}
                    disabled={saveEdit.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {/* Comments */}
              <div>
                <h4 className="text-sm font-semibold text-ink-primary mb-3">Comments</h4>
                <div className="space-y-3 mb-3 max-h-[200px] overflow-y-auto">
                  {comments.map((c: any) => (
                    <div key={c.id} className="flex gap-2">
                      <UserAvatar
                        name={c.user?.full_name ?? "?"}
                        avatarUrl={c.user?.avatar_url}
                        size="sm"
                      />
                      <div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-medium text-ink-primary">
                            {c.user?.full_name}
                          </span>
                          <span className="text-[10px] text-ink-muted">
                            {format(new Date(c.created_at), "MMM d, h:mm a")}
                          </span>
                        </div>
                        <p className="text-sm text-ink-secondary">{c.body}</p>
                      </div>
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <p className="text-xs text-ink-muted">No comments yet.</p>
                  )}
                </div>
                <div className="flex gap-2 items-end">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a comment... (Ctrl+Enter to send)"
                    className="flex min-h-[36px] max-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && comment.trim()) {
                        e.preventDefault();
                        addComment.mutate();
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    className="shrink-0 h-9"
                    onClick={() => comment.trim() && addComment.mutate()}
                    disabled={!comment.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="md:col-span-2 space-y-4">
              <div className="rounded-lg bg-muted p-4 space-y-4">
                {/* Assignees */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-2">
                    Assigned to
                  </p>
                  {editMode ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setAssigneeDropdownOpen(!assigneeDropdownOpen)}
                        className="flex w-full items-center min-h-[40px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring gap-1"
                      >
                        <span className="flex-1 flex flex-wrap gap-1 text-left">
                          {editAssignees.length === 0 ? (
                            <span className="text-muted-foreground">Select members...</span>
                          ) : (
                            editAssignees.map((id) => {
                              const emp = employees.find((e: any) => e.id === id);
                              return (
                                <span
                                  key={id}
                                  className="inline-flex items-center gap-1 rounded-pill bg-accent-light text-primary px-2 py-0.5 text-xs font-medium"
                                >
                                  {emp?.full_name ?? "..."}
                                  <button
                                    type="button"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      toggleAssignee(id);
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              );
                            })
                          )}
                        </span>
                        <ChevronDown className="h-4 w-4 text-ink-muted shrink-0" />
                      </button>
                      {assigneeDropdownOpen && (
                        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-[200px] overflow-y-auto">
                          {employees.map((emp: any) => {
                            const selected = editAssignees.includes(emp.id);
                            return (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() => toggleAssignee(emp.id)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                              >
                                <div
                                  className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                                    selected ? "bg-primary border-primary" : "border-border"
                                  }`}
                                >
                                  {selected && (
                                    <Check className="h-3 w-3 text-primary-foreground" />
                                  )}
                                </div>
                                <UserAvatar
                                  name={emp.full_name}
                                  avatarUrl={emp.avatar_url}
                                  size="sm"
                                />
                                <span className="text-ink-primary">{emp.full_name}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {task.task_assignees && task.task_assignees.length > 0 ? (
                        task.task_assignees.map((a: any) => (
                          <div key={a.user_id} className="flex items-center gap-2">
                            <UserAvatar
                              name={a.user?.full_name ?? "?"}
                              avatarUrl={a.user?.avatar_url}
                              size="sm"
                            />
                            <div>
                              <p className="text-sm font-medium text-ink-primary">
                                {a.user?.full_name}
                              </p>
                              <p className="text-xs text-ink-muted">{a.user?.email}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            name={task.assigned?.full_name ?? "?"}
                            avatarUrl={task.assigned?.avatar_url}
                            size="sm"
                          />
                          <p className="text-sm font-medium text-ink-primary">
                            {task.assigned?.full_name}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Created by */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
                    Created by
                  </p>
                  <p className="text-sm text-ink-primary">{task.assigner?.full_name ?? "—"}</p>
                </div>

                {/* Deadline */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
                    Deadline
                  </p>
                  {editMode ? (
                    <Input
                      type="date"
                      value={editDeadline}
                      min={today()}
                      onChange={(e) => setEditDeadline(e.target.value)}
                      className="h-9"
                    />
                  ) : (
                    <>
                      <p className="text-sm text-ink-primary">
                        {task.deadline
                          ? format(new Date(task.deadline), "MMM d, yyyy")
                          : "None"}
                      </p>
                      {daysLeft !== null && (
                        <p
                          className={`text-xs ${
                            daysLeft < 0 ? "text-destructive" : "text-ink-muted"
                          }`}
                        >
                          {daysLeft < 0
                            ? `Overdue by ${Math.abs(daysLeft)} days`
                            : daysLeft === 0
                            ? "Due today"
                            : `${daysLeft} days remaining`}
                        </p>
                      )}
                    </>
                  )}
                </div>

                {/* Category */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
                    Category
                  </p>
                  {editMode ? (
                    <Input
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      placeholder="e.g. Design, Development"
                      className="h-9"
                    />
                  ) : task.category ? (
                    <span className="text-xs bg-purple-light text-purple px-2 py-0.5 rounded-pill">
                      {task.category}
                    </span>
                  ) : (
                    <p className="text-sm text-ink-muted">—</p>
                  )}
                </div>

                {/* Created at */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">
                    Created
                  </p>
                  <p className="text-xs text-ink-muted">
                    {format(new Date(task.created_at), "MMM d, yyyy")}
                  </p>
                </div>
              </div>

              {/* Attachments */}
              <div className="rounded-lg bg-muted p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    Attachments {attachments.length > 0 && `(${attachments.length})`}
                  </p>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) {
                          Array.from(e.target.files).forEach((file) =>
                            uploadAttachment.mutate(file)
                          );
                        }
                        e.target.value = "";
                      }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-primary hover:underline"
                      disabled={uploadAttachment.isPending}
                    >
                      {uploadAttachment.isPending ? "Uploading..." : "+ Add file"}
                    </button>
                  </div>
                </div>
                {attachments.length > 0 ? (
                  <div className="space-y-1.5">
                    {attachments.map((att: any) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
                      >
                        <span className="truncate text-ink-secondary text-xs">
                          {att.file_name}
                        </span>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          <a
                            href={att.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="text-primary hover:text-primary/80"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          {isAdmin && (
                            <button
                              onClick={() => deleteAttachment.mutate(att)}
                              className="text-ink-muted hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">No attachments.</p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
