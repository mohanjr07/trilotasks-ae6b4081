import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Download, Trash2, Paperclip, Pencil, Check, ChevronDown, CornerDownRight, FolderKanban, ArrowRightCircle } from "lucide-react";
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

// ── Threaded Comment Component ─────────────────────────────────────────────────
interface CommentItemProps {
  comment: any;
  depth?: number;
  onReply: (parentId: string, parentAuthor: string) => void;
  replyingToId: string | null;
  replyText: string;
  onReplyTextChange: (v: string) => void;
  onSubmitReply: (parentId: string) => void;
  onCancelReply: () => void;
  replyInputRef: React.RefObject<HTMLTextAreaElement>;
  isSubmitting: boolean;
  currentUserId: string;
  supportsReplies: boolean;
}

function CommentItem({
  comment,
  depth = 0,
  onReply,
  replyingToId,
  replyText,
  onReplyTextChange,
  onSubmitReply,
  onCancelReply,
  replyInputRef,
  isSubmitting,
  currentUserId,
  supportsReplies,
}: CommentItemProps) {
  const isOwn = comment.user_id === currentUserId;
  const replies: any[] = comment.replies ?? [];
  const isReplyingHere = replyingToId === comment.id;

  return (
    <div className={depth > 0 ? "ml-6 border-l-2 border-border pl-3" : ""}>
      <div className="flex gap-2.5 group">
        <div className="shrink-0 mt-0.5">
          <UserAvatar
            name={comment.user?.full_name ?? "?"}
            avatarUrl={comment.user?.avatar_url}
            size="sm"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs font-semibold text-ink-primary">
              {comment.user?.full_name ?? "Unknown"}
            </span>
            {isOwn && (
              <span className="text-[9px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium leading-tight">
                You
              </span>
            )}
            <span className="text-[10px] text-ink-muted">
              {format(new Date(comment.created_at), "MMM d, h:mm a")}
            </span>
          </div>
          <p className="text-sm text-ink-secondary mt-0.5 break-words leading-relaxed">
            {comment.body}
          </p>
          {supportsReplies && depth === 0 && (
            <button
              onClick={() => onReply(comment.id, comment.user?.full_name ?? "Someone")}
              className="mt-1.5 text-[11px] text-ink-muted hover:text-primary flex items-center gap-1 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            >
              <CornerDownRight className="h-3 w-3" />
              Reply
            </button>
          )}
        </div>
      </div>

      {/* Inline reply input */}
      {isReplyingHere && supportsReplies && (
        <div className="mt-2 ml-9">
          <div className="flex items-center gap-1.5 mb-1.5">
            <CornerDownRight className="h-3 w-3 text-primary shrink-0" />
            <span className="text-[11px] text-ink-muted">
              Replying to{" "}
              <span className="font-semibold text-ink-primary">
                {comment.user?.full_name ?? "this comment"}
              </span>
            </span>
            <button
              onClick={onCancelReply}
              className="ml-auto text-[10px] text-ink-muted hover:text-destructive transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="flex gap-2 items-end">
            <textarea
              ref={replyInputRef}
              value={replyText}
              onChange={(e) => onReplyTextChange(e.target.value)}
              placeholder={`Reply to ${comment.user?.full_name ?? "this comment"}... (Ctrl+Enter to send)`}
              className="flex min-h-[36px] max-h-[100px] w-full rounded-md border border-primary/40 bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && replyText.trim()) {
                  e.preventDefault();
                  onSubmitReply(comment.id);
                }
                if (e.key === "Escape") onCancelReply();
              }}
            />
            <Button
              size="sm"
              className="shrink-0 h-9"
              onClick={() => replyText.trim() && onSubmitReply(comment.id)}
              disabled={!replyText.trim() || isSubmitting}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Nested replies */}
      {replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {replies.map((reply: any) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              onReply={onReply}
              replyingToId={replyingToId}
              replyText={replyText}
              onReplyTextChange={onReplyTextChange}
              onSubmitReply={onSubmitReply}
              onCancelReply={onCancelReply}
              replyInputRef={replyInputRef}
              isSubmitting={isSubmitting}
              currentUserId={currentUserId}
              supportsReplies={supportsReplies}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────────────────────
export default function TaskDetailModal({ task, onClose }: { task: any; onClose: () => void }) {
  const { user, isAdmin, profile } = useAuth();
  const queryClient = useQueryClient();
  const canManageTasks = profile?.role === "admin" || profile?.role === "manager";
  // Co-owner: assigned with co_owner role — can view but not edit progress
  const isCoOwnerOnly = !canManageTasks &&
    task?.task_assignees?.some((a: any) => a.user_id === user?.id && a.assignee_role === "co_owner") === true &&
    task?.task_assignees?.some((a: any) => a.user_id === user?.id && a.assignee_role !== "co_owner") !== true;

  const [progress, setProgress] = useState(task?.progress ?? 0);
  const [status, setStatus] = useState(task?.status ?? "todo");

  // Comment state
  const [comment, setComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; author: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [supportsReplies, setSupportsReplies] = useState(true);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const commentsBottomRef = useRef<HTMLDivElement>(null);

  // Edit state
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState(task?.title ?? "");
  const [editDescription, setEditDescription] = useState(task?.description ?? "");
  const [editPriority, setEditPriority] = useState<"low" | "medium" | "high">(task?.priority ?? "medium");
  const [editDeadline, setEditDeadline] = useState(task?.deadline ?? "");
  const [editCategory, setEditCategory] = useState(task?.category ?? "");
  const [editAssignees, setEditAssignees] = useState<string[]>(
    task?.task_assignees?.filter((a: any) => a.assignee_role !== "co_owner").map((a: any) => a.user_id) ?? []
  );
  const [editCoOwners, setEditCoOwners] = useState<string[]>(
    task?.task_assignees?.filter((a: any) => a.assignee_role === "co_owner").map((a: any) => a.user_id) ?? []
  );
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [coOwnerDropdownOpen, setCoOwnerDropdownOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [coOwnerSearch, setCoOwnerSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Move-to-project state
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveProjectId, setMoveProjectId] = useState<string>(task?.project_id ?? "");
  const [moveTeamId, setMoveTeamId] = useState<string>(task?.project_team_id ?? "");

  // Sync edit fields whenever the task prop changes (e.g. opening a different task)
  useEffect(() => {
    if (!task) return;
    setProgress(task.progress ?? 0);
    setStatus(task.status ?? "todo");
    setEditTitle(task.title ?? "");
    setEditDescription(task.description ?? "");
    setEditPriority(task.priority ?? "medium");
    setEditDeadline(task.deadline ?? "");
    setEditCategory(task.category ?? "");
    setEditAssignees(
      task.task_assignees?.filter((a: any) => a.assignee_role !== "co_owner").map((a: any) => a.user_id) ?? []
    );
    setEditCoOwners(
      task.task_assignees?.filter((a: any) => a.assignee_role === "co_owner").map((a: any) => a.user_id) ?? []
    );
    setEditMode(false);
    setMoveProjectId(task.project_id ?? "");
    setMoveTeamId(task.project_team_id ?? "");
  }, [task?.id]);

  useEffect(() => {
    if (replyingTo) setTimeout(() => replyInputRef.current?.focus(), 60);
  }, [replyingTo?.id]);

  // Fetch comments — tries with parent_id first, falls back gracefully if column doesn't exist yet
  const { data: comments = [] } = useQuery({
    queryKey: ["task-comments", task?.id],
    queryFn: async () => {
      // Try fetching with parent_id (requires migration to be run)
      const { data, error } = await supabase
        .from("task_comments")
        .select("id, body, created_at, parent_id, user_id, user:profiles!task_comments_user_id_fkey(full_name, avatar_url)")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true });

      if (error) {
        // If parent_id column doesn't exist yet, fall back to basic fetch without it
        if (error.message?.includes("parent_id") || error.code === "42703" || error.message?.includes("schema cache")) {
          setSupportsReplies(false);
          const { data: fallback, error: fallbackError } = await supabase
            .from("task_comments")
            .select("id, body, created_at, user_id, user:profiles!task_comments_user_id_fkey(full_name, avatar_url)")
            .eq("task_id", task.id)
            .order("created_at", { ascending: true });
          if (fallbackError) throw fallbackError;
          return (fallback ?? []).map((c: any) => ({ ...c, replies: [] }));
        }
        throw error;
      }

      setSupportsReplies(true);
      const all = data ?? [];
      // Build comment tree
      const map: Record<string, any> = {};
      all.forEach((c: any) => { map[c.id] = { ...c, replies: [] }; });
      const roots: any[] = [];
      all.forEach((c: any) => {
        if (c.parent_id && map[c.parent_id]) {
          map[c.parent_id].replies.push(map[c.id]);
        } else {
          roots.push(map[c.id]);
        }
      });
      return roots;
    },
    enabled: !!task,
    refetchInterval: 10000,
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

  // Projects list + teams (for Move to Project feature)
  const { data: allProjects = [] } = useQuery({
    queryKey: ["projects-for-move"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, color").order("name");
      return data ?? [];
    },
    enabled: moveOpen && isAdmin,
  });

  const { data: allProjectTeams = [] } = useQuery({
    queryKey: ["project-teams-for-move"],
    queryFn: async () => {
      const { data } = await supabase.from("project_teams").select("id, project_id, name").order("name");
      return data ?? [];
    },
    enabled: moveOpen && isAdmin,
  });

  // Look up the task's current project (for display even outside the move popover)
  const { data: currentProject } = useQuery({
    queryKey: ["project-of-task", task?.project_id],
    queryFn: async () => {
      if (!task?.project_id) return null;
      const { data } = await supabase
        .from("projects")
        .select("id, name, color")
        .eq("id", task.project_id)
        .single();
      return data;
    },
    enabled: !!task?.project_id,
  });

  const invalidateTasks = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
    queryClient.invalidateQueries({ queryKey: ["admin-tasks"] });
  };

  const invalidateComments = () =>
    queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });

  const moveTask = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("tasks")
        .update({
          project_id: moveProjectId || null,
          project_team_id: moveTeamId || null,
        })
        .eq("id", task.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateTasks();
      queryClient.invalidateQueries({ queryKey: ["my-team-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["admin-team-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["project-of-task"] });
      toast.success(moveProjectId ? "Task moved to project" : "Task removed from project");
      setMoveOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to move task"),
  });



  const updateProgressStatus = useMutation({
    mutationFn: async () => {
      await supabase.from("tasks").update({ progress, status }).eq("id", task.id);
    },
    onSuccess: () => { invalidateTasks(); toast.success("Task updated"); },
    onError: () => toast.error("Failed to update task"),
  });

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

      const { error: delError } = await supabase.from("task_assignees").delete().eq("task_id", task.id);
      if (delError) throw delError;

      const allAssigneeRows = [
        ...editAssignees.map((uid) => ({ task_id: task.id, user_id: uid, assignee_role: "owner" })),
        ...editCoOwners.map((uid) => ({ task_id: task.id, user_id: uid, assignee_role: "co_owner" })),
      ];
      const { error: insError } = await supabase
        .from("task_assignees")
        .insert(allAssigneeRows);
      if (insError) throw insError;

      // Notifications are handled by the DB trigger — no manual insert needed.
    },
    onSuccess: () => { invalidateTasks(); setEditMode(false); toast.success("Task saved successfully"); },
    onError: (e: any) => toast.error(e.message ?? "Failed to save task"),
  });

  const deleteTask = useMutation({
    mutationFn: async () => {
      await supabase.from("task_assignees").delete().eq("task_id", task.id);
      await supabase.from("task_comments").delete().eq("task_id", task.id);
      await supabase.from("task_attachments").delete().eq("task_id", task.id);
      const { error } = await supabase.from("tasks").delete().eq("id", task.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateTasks();
      toast.success("Task deleted");
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete task"),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const trimmed = comment.trim();
      if (!trimmed) return;
      const insertData: any = {
        task_id: task.id,
        user_id: user!.id,
        body: trimmed,
      };
      if (supportsReplies) {
        insertData.parent_id = null;
      }
      const { error } = await supabase.from("task_comments").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateComments();
      setComment("");
      setTimeout(() => commentsBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to add comment"),
  });

  const addReply = useMutation({
    mutationFn: async ({ body, parentId }: { body: string; parentId: string }) => {
      const trimmed = body.trim();
      if (!trimmed || !supportsReplies) return;
      const { error } = await supabase.from("task_comments").insert({
        task_id: task.id,
        user_id: user!.id,
        body: trimmed,
        parent_id: parentId,
      });
      if (error) {
        if (error.message?.includes("parent_id") || error.code === "42703" || error.message?.includes("schema cache")) {
          setSupportsReplies(false);
          throw new Error("Reply feature needs a DB migration. Run fix_comment_replies.sql in Supabase SQL Editor.");
        }
        throw error;
      }
    },
    onSuccess: () => {
      invalidateComments();
      setReplyingTo(null);
      setReplyText("");
      setTimeout(() => commentsBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to add reply"),
  });

  const deleteAttachment = useMutation({
    mutationFn: async (attachment: any) => {
      const url = new URL(attachment.file_url);
      const pathMatch = url.pathname.match(/\/task-attachments\/(.+)$/);
      if (pathMatch) await supabase.storage.from("task-attachments").remove([decodeURIComponent(pathMatch[1])]);
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
      const { error: uploadError } = await supabase.storage.from("task-attachments").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("task-attachments").getPublicUrl(filePath);
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
    setEditAssignees((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
    // Remove from co-owners if being added as owner
    setEditCoOwners((prev) => prev.filter((a) => a !== id));
  };
  const toggleCoOwner = (id: string) => {
    setEditCoOwners((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
    // Remove from owners if being added as co-owner
    setEditAssignees((prev) => prev.filter((a) => a !== id));
  };

  const cancelEdit = () => {
    setEditTitle(task?.title ?? "");
    setEditDescription(task?.description ?? "");
    setEditPriority(task?.priority ?? "medium");
    setEditDeadline(task?.deadline ?? "");
    setEditCategory(task?.category ?? "");
    setEditAssignees(task?.task_assignees?.filter((a: any) => a.assignee_role !== "co_owner").map((a: any) => a.user_id) ?? []);
    setEditCoOwners(task?.task_assignees?.filter((a: any) => a.assignee_role === "co_owner").map((a: any) => a.user_id) ?? []);
    setAssigneeDropdownOpen(false);
    setCoOwnerDropdownOpen(false);
    setAssigneeSearch("");
    setCoOwnerSearch("");
    setEditMode(false);
  };

  if (!task) return null;

  const daysLeft = task.deadline ? differenceInDays(new Date(task.deadline), new Date()) : null;
  const totalComments = comments.reduce((acc: number, c: any) => acc + 1 + (c.replies?.length ?? 0), 0);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-ink-primary/30"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
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
              <h2 className="font-heading text-lg font-bold text-ink-primary truncate flex-1">{task.title}</h2>
            )}
            <div className="flex items-center gap-2 shrink-0">
              {isAdmin && !editMode && (
                <button
                  onClick={() => setMoveOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-muted"
                  title="Move this task into a project"
                >
                  <ArrowRightCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">Move</span>
                </button>
              )}
              {isAdmin && !editMode && (
                <button
                  onClick={() => setEditMode(true)}
                  className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary transition-colors px-2 py-1 rounded-md hover:bg-muted"
                >
                  <Pencil className="h-4 w-4" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}
              {canManageTasks && !editMode && (
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to delete this task? This action cannot be undone.")) {
                      deleteTask.mutate();
                    }
                  }}
                  disabled={deleteTask.isPending}
                  className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-destructive transition-colors px-2 py-1 rounded-md hover:bg-destructive/10"
                  title="Delete task"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Delete</span>
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
              {/* Move-to-Project inline panel (admin only) */}
              {isAdmin && moveOpen && !editMode && (
                <div className="rounded-lg border-2 border-primary/30 bg-accent-light/30 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <FolderKanban className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-semibold text-ink-primary">Move task to a project</h4>
                    <button
                      onClick={() => setMoveOpen(false)}
                      className="ml-auto text-ink-muted hover:text-ink-primary"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-ink-muted mb-3">
                    Tasks moved here will appear inside the chosen project (and team, if selected) in the Projects section.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-primary">Project</label>
                      <Select
                        value={moveProjectId || "none"}
                        onValueChange={(v) => {
                          setMoveProjectId(v === "none" ? "" : v);
                          setMoveTeamId("");
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="No project" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No project (remove)</SelectItem>
                          {allProjects.map((p: any) => (
                            <SelectItem key={p.id} value={p.id}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: p.color }}
                                />
                                {p.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {moveProjectId &&
                      allProjectTeams.filter((t: any) => t.project_id === moveProjectId).length > 0 && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-ink-primary">Team (optional)</label>
                          <Select
                            value={moveTeamId || "none"}
                            onValueChange={(v) => setMoveTeamId(v === "none" ? "" : v)}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="No team" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No team</SelectItem>
                              {allProjectTeams
                                .filter((t: any) => t.project_id === moveProjectId)
                                .map((t: any) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => moveTask.mutate()}
                      disabled={moveTask.isPending}
                      className="gap-1.5"
                    >
                      <Check className="h-4 w-4" />
                      {moveTask.isPending ? "Moving..." : moveProjectId ? "Move to project" : "Remove from project"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setMoveOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {!editMode && (
                <div className="flex gap-2 flex-wrap">
                  <StatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                  {currentProject && (
                    <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-light text-primary px-2.5 py-0.5 text-xs font-medium">
                      <FolderKanban className="h-3 w-3" />
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: currentProject.color }}
                      />
                      {currentProject.name}
                    </span>
                  )}
                </div>
              )}

              {editMode ? (
                <div>
                  <label className="text-sm font-medium text-ink-primary mb-1.5 block">Description</label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    placeholder="Task description..."
                  />
                </div>
              ) : (
                task.description && <p className="text-sm text-ink-secondary">{task.description}</p>
              )}

              {editMode && (
                <div>
                  <label className="text-sm font-medium text-ink-primary mb-1.5 block">Priority</label>
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

              {/* Progress & Status */}
              <div>
                <label className="text-sm font-medium text-ink-primary mb-2 block">
                  Completion — <span className="text-primary font-heading text-xl">{progress}%</span>
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
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                {!isCoOwnerOnly ? (
                  <Button
                    size="sm"
                    onClick={() => updateProgressStatus.mutate()}
                    disabled={updateProgressStatus.isPending}
                    className="mt-3"
                  >
                    {updateProgressStatus.isPending ? "Saving..." : "Save Progress"}
                  </Button>
                ) : (
                  <p className="mt-3 text-xs text-ink-muted italic">View only — co-owners cannot update progress</p>
                )}
              </div>

              {editMode && (
                <div className="flex gap-2 pt-1 border-t border-border">
                  <Button onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending} size="sm" className="gap-1.5">
                    <Check className="h-4 w-4" />
                    {saveEdit.isPending ? "Saving..." : "Save Task"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelEdit} disabled={saveEdit.isPending}>
                    Cancel
                  </Button>
                </div>
              )}

              {/* ── Comments Section ── */}
              <div>
                <h4 className="text-sm font-semibold text-ink-primary mb-3 flex items-center gap-2">
                  Comments
                  {totalComments > 0 && (
                    <span className="text-[11px] bg-muted text-ink-muted rounded-full px-2 py-0.5 font-normal">
                      {totalComments}
                    </span>
                  )}
                </h4>

                {/* Thread list */}
                <div className="space-y-4 mb-4 max-h-[340px] overflow-y-auto pr-1 scroll-smooth">
                  {comments.length === 0 ? (
                    <p className="text-xs text-ink-muted py-3 text-center">No comments yet. Be the first!</p>
                  ) : (
                    comments.map((c: any) => (
                      <CommentItem
                        key={c.id}
                        comment={c}
                        depth={0}
                        onReply={(parentId, author) => {
                          setReplyingTo({ id: parentId, author });
                          setReplyText("");
                        }}
                        replyingToId={replyingTo?.id ?? null}
                        replyText={replyText}
                        onReplyTextChange={setReplyText}
                        onSubmitReply={(parentId) => {
                          if (replyText.trim()) addReply.mutate({ body: replyText, parentId });
                        }}
                        onCancelReply={() => { setReplyingTo(null); setReplyText(""); }}
                        replyInputRef={replyInputRef}
                        isSubmitting={addReply.isPending}
                        currentUserId={user?.id ?? ""}
                        supportsReplies={supportsReplies}
                      />
                    ))
                  )}
                  <div ref={commentsBottomRef} />
                </div>

                {/* New top-level comment input */}
                <div className="border-t border-border pt-3">
                  <div className="flex gap-2 items-end">
                    <div className="shrink-0 mt-1">
                      <UserAvatar
                        name={profile?.full_name ?? user?.email ?? "?"}
                        avatarUrl={profile?.avatar_url}
                        size="sm"
                      />
                    </div>
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
                      disabled={!comment.trim() || addComment.isPending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="md:col-span-2 space-y-4">
              <div className="rounded-lg bg-muted p-4 space-y-4">
                {/* Assignees */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-2">Assigned to</p>
                  {editMode ? (
                    <div className="space-y-3">
                      {/* Owner selector */}
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-ink-muted mb-1 font-semibold">Owner (can edit & view progress)</p>
                        <div className="relative">
                          <div
                            className="flex w-full flex-wrap items-center min-h-[38px] rounded-md border border-input bg-background px-3 py-1.5 text-sm gap-1 cursor-text"
                            onClick={() => setAssigneeDropdownOpen(true)}
                          >
                            {editAssignees.map((id) => {
                              const emp = employees.find((e: any) => e.id === id);
                              return (
                                <span key={id} className="inline-flex items-center gap-1 rounded-pill bg-accent-light text-primary px-2 py-0.5 text-xs font-medium">
                                  {emp?.full_name ?? "..."}
                                  <button type="button" onClick={(ev) => { ev.stopPropagation(); toggleAssignee(id); }}>
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
                              placeholder={editAssignees.length === 0 ? "Search owners..." : ""}
                              className="flex-1 min-w-[100px] bg-transparent outline-none text-sm text-ink-primary placeholder:text-muted-foreground"
                            />
                          </div>
                          {assigneeDropdownOpen && (
                            <>
                              <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-[180px] overflow-y-auto">
                                {employees
                                  .filter((emp: any) => emp.full_name.toLowerCase().includes(assigneeSearch.toLowerCase()))
                                  .map((emp: any) => {
                                    const selected = editAssignees.includes(emp.id);
                                    const isCoOwner = editCoOwners.includes(emp.id);
                                    return (
                                      <button
                                        key={emp.id}
                                        type="button"
                                        onMouseDown={(e) => { e.preventDefault(); toggleAssignee(emp.id); setAssigneeSearch(""); }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                                      >
                                        <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${selected ? "bg-primary border-primary" : "border-border"}`}>
                                          {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                                        </div>
                                        <UserAvatar name={emp.full_name} avatarUrl={emp.avatar_url} size="sm" />
                                        <span className="text-ink-primary flex-1">{emp.full_name}</span>
                                        {isCoOwner && <span className="text-[9px] bg-muted text-ink-muted px-1.5 py-0.5 rounded">co-owner</span>}
                                      </button>
                                    );
                                  })}
                              </div>
                              <div className="fixed inset-0 z-40" onClick={() => { setAssigneeDropdownOpen(false); setAssigneeSearch(""); }} />
                            </>
                          )}
                        </div>
                      </div>
                      {/* Co-Owner selector */}
                      <div>
                        <p className="text-[9px] uppercase tracking-wider text-ink-muted mb-1 font-semibold">Co-Owner (view only)</p>
                        <div className="relative">
                          <div
                            className="flex w-full flex-wrap items-center min-h-[38px] rounded-md border border-input bg-background px-3 py-1.5 text-sm gap-1 cursor-text"
                            onClick={() => setCoOwnerDropdownOpen(true)}
                          >
                            {editCoOwners.map((id) => {
                              const emp = employees.find((e: any) => e.id === id);
                              return (
                                <span key={id} className="inline-flex items-center gap-1 rounded-pill bg-muted text-ink-secondary px-2 py-0.5 text-xs font-medium">
                                  {emp?.full_name ?? "..."}
                                  <button type="button" onClick={(ev) => { ev.stopPropagation(); toggleCoOwner(id); }}>
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              );
                            })}
                            <input
                              type="text"
                              value={coOwnerSearch}
                              onChange={(e) => { setCoOwnerSearch(e.target.value); setCoOwnerDropdownOpen(true); }}
                              onFocus={() => setCoOwnerDropdownOpen(true)}
                              placeholder={editCoOwners.length === 0 ? "Search co-owners..." : ""}
                              className="flex-1 min-w-[100px] bg-transparent outline-none text-sm text-ink-primary placeholder:text-muted-foreground"
                            />
                          </div>
                          {coOwnerDropdownOpen && (
                            <>
                              <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-[180px] overflow-y-auto">
                                {employees
                                  .filter((emp: any) => emp.full_name.toLowerCase().includes(coOwnerSearch.toLowerCase()))
                                  .map((emp: any) => {
                                    const selected = editCoOwners.includes(emp.id);
                                    const isOwner = editAssignees.includes(emp.id);
                                    return (
                                      <button
                                        key={emp.id}
                                        type="button"
                                        onMouseDown={(e) => { e.preventDefault(); toggleCoOwner(emp.id); setCoOwnerSearch(""); }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                                      >
                                        <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${selected ? "bg-primary border-primary" : "border-border"}`}>
                                          {selected && <Check className="h-3 w-3 text-primary-foreground" />}
                                        </div>
                                        <UserAvatar name={emp.full_name} avatarUrl={emp.avatar_url} size="sm" />
                                        <span className="text-ink-primary flex-1">{emp.full_name}</span>
                                        {isOwner && <span className="text-[9px] bg-accent-light text-primary px-1.5 py-0.5 rounded">owner</span>}
                                      </button>
                                    );
                                  })}
                              </div>
                              <div className="fixed inset-0 z-40" onClick={() => { setCoOwnerDropdownOpen(false); setCoOwnerSearch(""); }} />
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {task.task_assignees && task.task_assignees.length > 0 ? (
                        <>
                          {/* Owners */}
                          {task.task_assignees.filter((a: any) => a.assignee_role !== "co_owner").length > 0 && (
                            <div>
                              <p className="text-[9px] uppercase tracking-wider text-ink-muted mb-1.5 font-semibold">Owner{task.task_assignees.filter((a: any) => a.assignee_role !== "co_owner").length > 1 ? "s" : ""}</p>
                              <div className="space-y-1.5">
                                {task.task_assignees.filter((a: any) => a.assignee_role !== "co_owner").map((a: any) => (
                                  <div key={a.user_id} className="flex items-center gap-2">
                                    <UserAvatar name={a.user?.full_name ?? "?"} avatarUrl={a.user?.avatar_url} size="sm" />
                                    <div className="flex-1">
                                      <p className="text-sm font-medium text-ink-primary">{a.user?.full_name}</p>
                                      <p className="text-xs text-ink-muted">{a.user?.email}</p>
                                    </div>
                                    <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Owner</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Co-Owners */}
                          {task.task_assignees.filter((a: any) => a.assignee_role === "co_owner").length > 0 && (
                            <div>
                              <p className="text-[9px] uppercase tracking-wider text-ink-muted mb-1.5 font-semibold">Co-Owner{task.task_assignees.filter((a: any) => a.assignee_role === "co_owner").length > 1 ? "s" : ""}</p>
                              <div className="space-y-1.5">
                                {task.task_assignees.filter((a: any) => a.assignee_role === "co_owner").map((a: any) => (
                                  <div key={a.user_id} className="flex items-center gap-2">
                                    <UserAvatar name={a.user?.full_name ?? "?"} avatarUrl={a.user?.avatar_url} size="sm" />
                                    <div className="flex-1">
                                      <p className="text-sm font-medium text-ink-primary">{a.user?.full_name}</p>
                                      <p className="text-xs text-ink-muted">{a.user?.email}</p>
                                    </div>
                                    <span className="text-[9px] bg-muted text-ink-muted px-1.5 py-0.5 rounded font-medium">View only</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <UserAvatar name={task.assigned?.full_name ?? "?"} avatarUrl={task.assigned?.avatar_url} size="sm" />
                          <p className="text-sm font-medium text-ink-primary">{task.assigned?.full_name}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Created by */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Created by</p>
                  <p className="text-sm text-ink-primary">{task.assigner?.full_name ?? "—"}</p>
                </div>

                {/* Deadline */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Deadline</p>
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
                        {task.deadline ? format(new Date(task.deadline), "MMM d, yyyy") : "None"}
                      </p>
                      {daysLeft !== null && (
                        <p className={`text-xs ${daysLeft < 0 ? "text-destructive" : "text-ink-muted"}`}>
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
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Category</p>
                  {editMode ? (
                    <Input
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      placeholder="e.g. Design, Development"
                      className="h-9"
                    />
                  ) : task.category ? (
                    <span className="text-xs bg-purple-light text-purple px-2 py-0.5 rounded-pill">{task.category}</span>
                  ) : (
                    <p className="text-sm text-ink-muted">—</p>
                  )}
                </div>

                {/* Created at */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Created</p>
                  <p className="text-xs text-ink-muted">{format(new Date(task.created_at), "MMM d, yyyy")}</p>
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
                        if (e.target.files) Array.from(e.target.files).forEach((file) => uploadAttachment.mutate(file));
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
                      <div key={att.id} className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-sm">
                        <span className="truncate text-ink-secondary text-xs">{att.file_name}</span>
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
