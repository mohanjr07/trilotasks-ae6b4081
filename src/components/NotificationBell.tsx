import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

// Bridge exposed by electron/preload.cjs (only present inside the .exe).
declare global {
  interface Window {
    IS_ELECTRON?: boolean;
    taskflowDesktop?: { focusWindow: () => void };
  }
}

const iconColors: Record<string, string> = {
  task: "bg-accent-light text-primary",
  leave: "bg-warning-light text-warning",
  system: "bg-muted text-ink-muted",
};

export default function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications-bell", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("notifications").select("*")
        .eq("user_id", user!.id).order("created_at", { ascending: false }).limit(8);
      return data ?? [];
    },
    enabled: !!user,
  });

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;

  // Ask the OS for permission to show desktop notifications. Only prompts
  // once — subsequent calls are a no-op if the user already accepted/declined.
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      // Fire-and-forget — we don't block the UI on the prompt.
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Realtime subscription — fires both an in-app toast and (if allowed) a
  // native OS desktop notification (Windows Action Center / macOS Notification
  // Center). Clicking the OS notification brings the TaskFlow window to the
  // front and navigates to /notifications.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('user-notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        queryClient.invalidateQueries({ queryKey: ["notifications-bell"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
        const n = payload.new as any;
        const title = n.title ?? "TaskFlow";
        const body = n.body ?? "";

        // In-app toast (visible only when the window is open and focused).
        toast(title, { description: body });

        // Native desktop notification (visible regardless of window state —
        // even when TaskFlow is hidden in the system tray).
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          try {
            const desktop = new Notification(title, {
              body,
              tag: n.id ?? undefined,    // dedupes if Supabase replays an event
              silent: false,
            });
            desktop.onclick = () => {
              // Inside the .exe: ask main process to un-hide / focus window.
              if (window.taskflowDesktop?.focusWindow) {
                window.taskflowDesktop.focusWindow();
              }
              // Inside a browser tab: focus the tab.
              window.focus();
              navigate("/notifications");
            };
          } catch {
            // Some platforms/permissions throw on construction — ignore;
            // the in-app toast already handled the user-visible part.
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, navigate, queryClient]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-bell"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await supabase.from("notifications").update({ is_read: true }).eq("user_id", user!.id).eq("is_read", false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-bell"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative text-ink-secondary hover:text-ink-primary transition-colors">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="absolute right-0 top-full mt-2 w-[340px] rounded-card bg-card shadow-modal border border-border z-50"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-ink-primary">Notifications</h3>
              {unreadCount > 0 && (
                <button onClick={() => markAllRead.mutate()} className="text-xs text-primary hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[380px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-sm text-ink-muted">No notifications yet</div>
              ) : notifications.map((n: any) => (
                <div
                  key={n.id}
                  onClick={() => { if (!n.is_read) markRead.mutate(n.id); }}
                  className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                    !n.is_read ? "bg-accent-light/30 border-l-2 border-l-primary" : ""
                  }`}
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconColors[n.type ?? "system"]}`}>
                    <Bell className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!n.is_read ? "font-semibold text-ink-primary" : "text-ink-secondary"} truncate`}>{n.title}</p>
                    <p className="text-xs text-ink-muted truncate">{n.body}</p>
                  </div>
                  <span className="text-[10px] text-ink-muted whitespace-nowrap">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block text-center py-3 text-sm text-primary hover:underline border-t border-border"
            >
              View all notifications →
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
