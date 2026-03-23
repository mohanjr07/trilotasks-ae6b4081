import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import UserAvatar from "@/components/UserAvatar";
import { toast } from "sonner";

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional(),
  assigned_to: z.string().min(1, "Assignee is required"),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(["todo", "in_progress", "on_hold", "completed"]),
  deadline: z.string().min(1, "Deadline is required"),
  category: z.string().max(50).optional(),
});
type FormData = z.infer<typeof schema>;

export default function CreateTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-list"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, avatar_url").eq("is_active", true);
      return data ?? [];
    },
    enabled: open,
  });

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { priority: "medium", status: "todo" },
  });

  const createTask = useMutation({
    mutationFn: async (data: FormData) => {
      const { error } = await supabase.from("tasks").insert([{
        title: data.title,
        description: data.description || null,
        assigned_to: data.assigned_to,
        priority: data.priority,
        status: data.status,
        deadline: data.deadline,
        category: data.category || null,
        assigned_by: user!.id,
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["admin-tasks"] });
      toast.success("Task created successfully");
      reset();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const priorities = ["low", "medium", "high"] as const;
  const priorityColors = { low: "bg-success-light text-success border-success/20", medium: "bg-warning-light text-warning border-warning/20", high: "bg-destructive-light text-destructive border-destructive/20" };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-modal bg-card p-6 shadow-modal mx-4"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-heading text-xl font-bold text-ink-primary">Create Task</h2>
              <button onClick={onClose} className="text-ink-muted hover:text-ink-primary"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={handleSubmit((d) => createTask.mutate(d))} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Title *</label>
                <Input {...register("title")} autoFocus className="h-10" />
                {errors.title && <p className="mt-1 text-xs text-destructive">{errors.title.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Description</label>
                <Textarea {...register("description")} rows={3} />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Assign To *</label>
                <Select onValueChange={(v) => setValue("assigned_to", v)} value={watch("assigned_to")}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((emp: any) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        <div className="flex items-center gap-2">
                          <UserAvatar name={emp.full_name} avatarUrl={emp.avatar_url} size="sm" />
                          <span>{emp.full_name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.assigned_to && <p className="mt-1 text-xs text-destructive">{errors.assigned_to.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Priority *</label>
                <div className="flex gap-2">
                  {priorities.map((p) => (
                    <button key={p} type="button" onClick={() => setValue("priority", p)}
                      className={`flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition-all ${watch("priority") === p ? priorityColors[p] + " border-current" : "border-border text-ink-secondary hover:bg-muted"}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Status</label>
                  <Select onValueChange={(v: any) => setValue("status", v)} value={watch("status")}>
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
                  <Input {...register("deadline")} type="date" className="h-10" />
                  {errors.deadline && <p className="mt-1 text-xs text-destructive">{errors.deadline.message}</p>}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-primary">Category</label>
                <Input {...register("category")} placeholder="e.g. Design, Development" className="h-10" />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
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
