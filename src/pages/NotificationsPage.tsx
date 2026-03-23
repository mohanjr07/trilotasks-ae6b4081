import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const iconColors: Record<string, string> = {
  task: "bg-accent-light text-primary",
  leave: "bg-warning-light text-warning",
  system: "bg-muted text-ink-muted",
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("notifications").select("*").eq("user_id", user!.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await supabase.from("notifications").update({ is_read: true }).eq("user_id", user!.id).eq("is_read", false);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["notifications"] }); toast.success("All marked as read"); },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-[28px] font-bold text-ink-primary">Notifications</h1>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} className="gap-2">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
        {notifications.map((n: any) => (
          <motion.div key={n.id} variants={staggerItem}
            onClick={() => !n.is_read && markRead.mutate(n.id)}
            className={`flex items-start gap-3 rounded-card p-4 cursor-pointer transition-colors ${!n.is_read ? "bg-card shadow-card border-l-2 border-l-primary" : "bg-muted/50 hover:bg-muted"}`}>
            <div className={`flex h-9 w-9 items-center justify-center rounded-full ${iconColors[n.type ?? "system"]}`}>
              <Bell className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink-primary">{n.title}</p>
              <p className="text-xs text-ink-muted mt-0.5">{n.body}</p>
            </div>
            <span className="text-[10px] text-ink-muted whitespace-nowrap">{format(new Date(n.created_at), "MMM d, h:mm a")}</span>
          </motion.div>
        ))}
        {notifications.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-muted">No notifications yet</div>
        )}
      </motion.div>
    </AnimatedPage>
  );
}
