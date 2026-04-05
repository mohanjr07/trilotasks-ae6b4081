import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Download, Trash2, Paperclip } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function TaskDetailModal({ task, onClose }: { task: any; onClose: () => void }) {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(task?.progress ?? 0);
  const [status, setStatus] = useState(task?.status ?? "todo");
  const [comment, setComment] = useState("");

  const { data: comments = [] } = useQuery({
    queryKey: ["task-comments", task?.id],
    queryFn: async () => {
      const { data } = await supabase.from("task_comments").select("*, user:profiles!task_comments_user_id_fkey(full_name, avatar_url)")
        .eq("task_id", task.id).order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!task,
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ["task-attachments", task?.id],
    queryFn: async () => {
      const { data } = await supabase.from("task_attachments").select("*").eq("task_id", task.id).order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!task,
  });

  const deleteAttachment = useMutation({
    mutationFn: async (attachment: any) => {
      const url = new URL(attachment.file_url);
      const pathMatch = url.pathname.match(/\/task-attachments\/(.+)$/);
      if (pathMatch) {
        await supabase.storage.from("task-attachments").remove([decodeURIComponent(pathMatch[1])]);
      }
      await supabase.from("task_attachments").delete().eq("id", attachment.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-attachments", task?.id] });
      toast.success("Attachment removed");
    },
    onError: () => toast.error("Failed to remove attachment"),
  });

  const updateTask = useMutation({
    mutationFn: async () => {
      await supabase.from("tasks").update({ progress, status }).eq("id", task.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["admin-tasks"] });
      toast.success("Task updated");
    },
  });

  const addComment = useMutation({
    mutationFn: async () => {
      await supabase.from("task_comments").insert({ task_id: task.id, user_id: user!.id, body: comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-comments", task.id] });
      setComment("");
      toast.success("Comment added");
    },
  });

  if (!task) return null;

  const daysLeft = task.deadline ? differenceInDays(new Date(task.deadline), new Date()) : null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-[720px] max-h-[90vh] overflow-y-auto rounded-modal bg-card shadow-modal mx-4"
        >
          <div className="sticky top-0 bg-card z-10 flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading text-lg font-bold text-ink-primary truncate pr-4">{task.title}</h2>
            <button onClick={onClose} className="text-ink-muted hover:text-ink-primary"><X className="h-5 w-5" /></button>
          </div>

          <div className="grid md:grid-cols-5 gap-6 p-5">
            {/* Left column */}
            <div className="md:col-span-3 space-y-5">
              <div className="flex gap-2">
                <StatusBadge status={task.status} />
                <PriorityBadge priority={task.priority} />
              </div>

              {task.description && (
                <p className="text-sm text-ink-secondary">{task.description}</p>
              )}

              <div>
                <label className="text-sm font-medium text-ink-primary mb-2 block">
                  Completion — <span className="text-primary font-heading text-xl">{progress}%</span>
                </label>
                <Slider value={[progress]} onValueChange={([v]) => {
                  setProgress(v);
                  if (v === 100) setStatus("completed");
                }} max={100} step={5} className="my-3" />
                <Select value={status} onValueChange={(v) => {
                  setStatus(v);
                  if (v === "completed") setProgress(100);
                }}>
                  <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => updateTask.mutate()} disabled={updateTask.isPending} className="mt-3">
                  {updateTask.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>

              {/* Comments */}
              <div>
                <h4 className="text-sm font-semibold text-ink-primary mb-3">Comments</h4>
                <div className="space-y-3 mb-3 max-h-[200px] overflow-y-auto">
                  {comments.map((c: any) => (
                    <div key={c.id} className="flex gap-2">
                      <UserAvatar name={c.user?.full_name ?? "?"} avatarUrl={c.user?.avatar_url} size="sm" />
                      <div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-medium text-ink-primary">{c.user?.full_name}</span>
                          <span className="text-[10px] text-ink-muted">{format(new Date(c.created_at), "MMM d, h:mm a")}</span>
                        </div>
                        <p className="text-sm text-ink-secondary">{c.body}</p>
                      </div>
                    </div>
                  ))}
                  {comments.length === 0 && <p className="text-xs text-ink-muted">No comments yet.</p>}
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
                  <Button size="sm" className="shrink-0 h-9" onClick={() => comment.trim() && addComment.mutate()} disabled={!comment.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="md:col-span-2 space-y-4">
              <div className="rounded-lg bg-muted p-4 space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Assigned to</p>
                  <div className="space-y-2">
                    {(task.task_assignees && task.task_assignees.length > 0) ? (
                      task.task_assignees.map((a: any) => (
                        <div key={a.user_id} className="flex items-center gap-2">
                          <UserAvatar name={a.user?.full_name ?? "?"} avatarUrl={a.user?.avatar_url} size="sm" />
                          <div>
                            <p className="text-sm font-medium text-ink-primary">{a.user?.full_name}</p>
                            <p className="text-xs text-ink-muted">{a.user?.email}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-2">
                        <UserAvatar name={task.assigned?.full_name ?? "?"} avatarUrl={task.assigned?.avatar_url} size="sm" />
                        <div>
                          <p className="text-sm font-medium text-ink-primary">{task.assigned?.full_name}</p>
                          <p className="text-xs text-ink-muted">{task.assigned?.email}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Created by</p>
                  <p className="text-sm text-ink-primary">{task.assigner?.full_name ?? "—"}</p>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Deadline</p>
                  <p className="text-sm text-ink-primary">
                    {task.deadline ? format(new Date(task.deadline), "MMM d, yyyy") : "None"}
                  </p>
                  {daysLeft !== null && (
                    <p className={`text-xs ${daysLeft < 0 ? "text-destructive" : "text-ink-muted"}`}>
                      {daysLeft < 0 ? `Overdue by ${Math.abs(daysLeft)} days` : daysLeft === 0 ? "Due today" : `${daysLeft} days remaining`}
                    </p>
                  )}
                </div>

                {task.category && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Category</p>
                    <span className="text-xs bg-purple-light text-purple px-2 py-0.5 rounded-pill">{task.category}</span>
                  </div>
                )}

                <div>
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Created</p>
                  <p className="text-xs text-ink-muted">{format(new Date(task.created_at), "MMM d, yyyy")}</p>
                </div>
              </div>

              {/* Attachments */}
              {attachments.length > 0 && (
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-[10px] uppercase tracking-wider text-ink-muted mb-2 flex items-center gap-1">
                    <Paperclip className="h-3 w-3" /> Attachments ({attachments.length})
                  </p>
                  <div className="space-y-1.5">
                    {attachments.map((att: any) => (
                      <div key={att.id} className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-sm">
                        <span className="truncate text-ink-secondary text-xs">{att.file_name}</span>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          <a href={att.file_url} target="_blank" rel="noopener noreferrer" download className="text-primary hover:text-primary/80">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                          {isAdmin && (
                            <button onClick={() => deleteAttachment.mutate(att)} className="text-ink-muted hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
