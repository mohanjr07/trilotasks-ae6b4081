import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow, isToday, isYesterday, format } from "date-fns";
import { motion } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";

const iconColors: Record<string, string> = {
  task: "bg-accent-light text-primary",
  leave: "bg-warning-light text-warning",
  system: "bg-muted text-ink-muted",
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("notifications").select("*").eq("user_id", user!.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
  });

  const filtered = notifications.filter((n: any) => {
    if (filter === "unread") return !n.is_read;
    if (filter === "task" || filter === "leave" || filter === "system") return n.type === filter;
    return true;
  });

  // Group by date
  const grouped = filtered.reduce((acc: Record<string, any[]>, n: any) => {
    const d = new Date(n.created_at);
    const key = isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "MMM d, yyyy");
    if (!acc[key]) acc[key] = [];
    acc[key].push(n);
    return acc;
  }, {});

  const markAllRead = useMutation({
    mutationFn: async () => {
      await supabase.from("notifications").update({ is_read: true }).eq("user_id", user!.id).eq("is_read", false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-bell"] });
      toast.success("All marked as read");
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-bell"] });
    },
  });

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;
  const tabs = ["all", "unread", "task", "leave", "system"];

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-[28px] font-bold text-ink-primary">Notifications</h1>
          {unreadCount > 0 && (
            <span className="text-xs font-medium bg-destructive text-destructive-foreground px-2 py-0.5 rounded-pill">{unreadCount}</span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} className="gap-2">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      <div className="flex gap-1 mb-6 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button key={t} onClick={() => setFilter(t)}
            className={`relative px-4 py-2.5 text-sm font-medium capitalize whitespace-nowrap transition-colors ${filter === t ? "text-primary" : "text-ink-muted hover:text-ink-secondary"}`}>
            {t}
            {filter === t && <motion.div layoutId="notif-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Bell} title="You're all caught up! 🎉" description="No notifications yet" />
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{date}</h3>
              <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
                {(items as any[]).map((n) => (
                  <motion.div key={n.id} variants={staggerItem}
                    onClick={() => !n.is_read && markRead.mutate(n.id)}
                    className={`flex items-start gap-3 rounded-card p-4 cursor-pointer transition-colors ${
                      !n.is_read ? "bg-card shadow-card border-l-2 border-l-primary" : "bg-muted/50 hover:bg-muted"
                    }`}>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 ${iconColors[n.type ?? "system"]}`}>
                      <Bell className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.is_read ? "font-semibold text-ink-primary" : "text-ink-secondary"}`}>{n.title}</p>
                      <p className="text-xs text-ink-muted mt-0.5">{n.body}</p>
                    </div>
                    <span className="text-[10px] text-ink-muted whitespace-nowrap">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          ))}
        </div>
      )}
    </AnimatedPage>
  );
}
