// ─────────────────────────────────────────────────────────────────────────────
//  Announcement pop-up: shown on every page until the person closes it.
//  New announcements appear live (realtime). Several waiting → one at a time.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import { Megaphone, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export type Announcement = {
  id: string; title: string; message: string; active: boolean;
  expires_at: string | null; created_by: string | null; created_at: string;
};
const sb = supabase as any;

export default function AnnouncementPopup() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [closing, setClosing] = useState<string[]>([]);   // closed in this session (hide at once)

  const { data: list = [] } = useQuery({
    queryKey: ["announcements-pending", user?.id],
    enabled: !!user,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [{ data: anns, error }, { data: seen }] = await Promise.all([
        sb.from("announcements").select("*").eq("active", true).order("created_at", { ascending: true }).limit(20),
        sb.from("announcement_dismissals").select("announcement_id").eq("user_id", user!.id),
      ]);
      if (error) return [] as Announcement[];            // not set up yet → nothing to show
      const done = new Set(((seen ?? []) as Array<{ announcement_id: string }>).map((s) => s.announcement_id));
      const now = Date.now();
      return ((anns ?? []) as Announcement[]).filter((a) =>
        !done.has(a.id) && a.created_by !== user!.id && (!a.expires_at || new Date(a.expires_at).getTime() > now));
    },
  });

  // live: a new / changed announcement shows straight away
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("announcements-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () =>
        qc.invalidateQueries({ queryKey: ["announcements-pending"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, qc]);

  const { data: names = {} } = useQuery({
    queryKey: ["announcement-senders", list.map((a) => a.created_by).join(",")],
    enabled: list.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.rpc("get_active_profiles");
      return Object.fromEntries(((data ?? []) as any[]).map((p) => [p.id, p.full_name])) as Record<string, string>;
    },
  });

  const waiting = list.filter((a) => !closing.includes(a.id));
  const current = waiting[0];

  const close = async () => {
    if (!current || !user) return;
    setClosing((c) => [...c, current.id]);
    await sb.from("announcement_dismissals").upsert({ announcement_id: current.id, user_id: user.id }, { onConflict: "announcement_id,user_id", ignoreDuplicates: true });
  };

  return (
    <AnimatePresence>
      {current && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ann-title">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-primary/40 backdrop-blur-[2px]" />
          <motion.div key={current.id}
            initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}
            className="relative w-full max-w-md overflow-hidden rounded-modal bg-card shadow-modal">
            <div className="flex items-start gap-3 bg-primary px-5 py-4 text-primary-foreground">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Megaphone className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">
                  Announcement{waiting.length > 1 ? ` · 1 of ${waiting.length}` : ""}
                </p>
                <h2 id="ann-title" className="font-heading text-lg font-bold leading-snug break-words">{current.title}</h2>
              </div>
              <button type="button" onClick={close} aria-label="Close announcement"
                className="-mr-1 rounded-full p-1.5 hover:bg-white/15">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[55dvh] overflow-y-auto px-5 py-4">
              {current.message && (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-primary">{current.message}</p>
              )}
              <p className="mt-3 text-xs text-ink-muted">
                {current.created_by && names[current.created_by] ? `${names[current.created_by]} · ` : ""}
                {format(new Date(current.created_at), "d MMM yyyy, h:mm a")}
              </p>
            </div>
            <div className="flex justify-end border-t border-border px-5 py-3">
              <Button onClick={close}>{waiting.length > 1 ? "Next" : "Got it"}</Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
