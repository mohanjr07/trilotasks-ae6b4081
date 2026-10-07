import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

// Bridge exposed by electron/preload.cjs (only present inside the .exe / .dmg).
declare global {
  interface Window {
    IS_ELECTRON?: boolean;
    taskflowDesktop?: {
      focusWindow: () => void;
      showNotification: (opts: { title: string; body: string; route?: string }) => void;
      onNotificationClicked: (cb: (payload: { route: string }) => void) => () => void;
    };
  }
}

const iconColors: Record<string, string> = {
  task: "bg-accent-light text-primary",
  leave: "bg-warning-light text-warning",
  system: "bg-muted text-ink-muted",
  form: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
};

// Fire a native desktop notification via whichever channel is available:
//   1. Electron IPC (Teams-style, shows app icon, groups in Action Center).
//   2. Web Notification API (fallback for browser / web deployment).
function fireDesktopNotification(
  title: string,
  body: string,
  route: string,
  navigate: (path: string) => void
) {
  // ── Electron path ──────────────────────────────────────────────────────
  if (window.IS_ELECTRON && window.taskflowDesktop?.showNotification) {
    window.taskflowDesktop.showNotification({ title, body, route });
    // The click handler is registered once in NotificationBell via
    // onNotificationClicked — no need to wire it up here.
    return;
  }

  // ── Web Notification API fallback ──────────────────────────────────────
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body, tag: route, silent: false });
      n.onclick = () => {
        window.focus();
        navigate(route);
      };
    } catch {
      // Some browsers throw on construction — the in-app toast already fired.
    }
  }
}

export default function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications-bell", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(8);
      return data ?? [];
    },
    enabled: !!user,
  });

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;

  // Request Web Notification permission on first load (browser fallback).
  // In Electron this is a no-op — the native path needs no permission prompt.
  useEffect(() => {
    if (
      !window.IS_ELECTRON &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Register the Electron notification-click listener once on mount.
  // When the user clicks a native toast the main process sends "notify:clicked"
  // → we focus the window and navigate to the correct route.
  useEffect(() => {
    if (!window.IS_ELECTRON || !window.taskflowDesktop?.onNotificationClicked) return;
    const unsubscribe = window.taskflowDesktop.onNotificationClicked(({ route }) => {
      navigate(route ?? "/notifications");
    });
    return unsubscribe;
  }, [navigate]);

  // Supabase realtime subscription — new notification row → in-app toast +
  // native desktop notification (Teams-style in Electron, Web API in browser).
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("user-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ["notifications-bell"] });
          queryClient.invalidateQueries({ queryKey: ["notifications"] });

          const n = payload.new as any;
          const title = n.title ?? "TaskFlow";
          const body = n.body ?? "";
          const route = n.type === "form" && n.reference_id ? `/form-requests?id=${n.reference_id}` : n.type === "payment" ? "/payments" : n.type === "overtime" ? "/overtime" : "/notifications";

          // In-app toast (always shown when the window is visible).
          toast(title, { description: body });

          // Native OS notification (visible even when window is hidden/minimised).
          fireDesktopNotification(title, body, route, navigate);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user!.id)
        .eq("is_read", false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-bell"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Close dropdown on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary hover:text-ink-primary hover:bg-muted transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full ring-2 ring-card bg-destructive text-[10px] font-bold text-destructive-foreground px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed left-3 right-3 top-[calc(64px+var(--sat))] md:absolute md:left-auto md:right-0 md:top-full md:mt-2 md:w-[340px] rounded-card bg-card shadow-modal border border-border z-50"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-ink-primary">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-xs text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[380px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center text-sm text-ink-muted">
                  No notifications yet
                </div>
              ) : (
                notifications.map((n: any) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (!n.is_read) markRead.mutate(n.id);
                      if (n.type === "form" && n.reference_id) {
                        setOpen(false);
                        navigate(`/form-requests?id=${n.reference_id}`);
                      } else if (n.type === "payment" || n.type === "overtime") {
                        setOpen(false);
                        navigate(n.type === "payment" ? "/payments" : "/overtime");
                      }
                    }}
                    className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                      !n.is_read ? "bg-accent-light/30 border-l-2 border-l-primary" : ""
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        iconColors[n.type ?? "system"]
                      }`}
                    >
                      <Bell className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm ${
                          !n.is_read
                            ? "font-semibold text-ink-primary"
                            : "text-ink-secondary"
                        } truncate`}
                      >
                        {n.title}
                      </p>
                      <p className="text-xs text-ink-muted truncate">{n.body}</p>
                    </div>
                    <span className="text-[10px] text-ink-muted whitespace-nowrap">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </span>
                  </div>
                ))
              )}
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
