// ─────────────────────────────────────────────────────────────────────────────
//  Announcements (admins): post a message that pops up on everyone's screen,
//  see how many have read it, stop showing it or delete it.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Megaphone, Send, Loader2, Trash2, EyeOff, Eye, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Announcement } from "@/components/AnnouncementPopup";

const sb = supabase as any;

export default function AnnouncementsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [until, setUntil] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["announcements-admin"],
    enabled: isAdmin,
    queryFn: async () => {
      const [a, d, p] = await Promise.all([
        sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(200),
        sb.from("announcement_dismissals").select("announcement_id, user_id"),
        supabase.rpc("get_active_profiles"),
      ]);
      if (a.error) throw a.error;
      const seen = new Map<string, number>();
      for (const r of (d.data ?? []) as Array<{ announcement_id: string }>) seen.set(r.announcement_id, (seen.get(r.announcement_id) ?? 0) + 1);
      const people = (p.data ?? []) as Array<{ id: string; full_name: string }>;
      return { list: (a.data ?? []) as Announcement[], seen, names: Object.fromEntries(people.map((x) => [x.id, x.full_name])), total: people.length };
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["announcements-admin"] });
    qc.invalidateQueries({ queryKey: ["announcements-pending"] });
  };

  const post = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Enter a title");
      const { error } = await sb.from("announcements").insert({
        title: title.trim(), message: message.trim(),
        expires_at: until ? new Date(until + "T23:59:59").toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Announcement sent — it pops up for everyone now"); setTitle(""); setMessage(""); setUntil(""); refresh(); },
    onError: (e: any) => toast.error(/announcements/.test(e?.message ?? "") ? "Run TRILO_announcements.sql first" : e?.message ?? "Could not send"),
  });
  const toggle = useMutation({
    mutationFn: async (a: Announcement) => {
      const { error } = await sb.from("announcements").update({ active: !a.active }).eq("id", a.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.message ?? ""),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Announcement deleted"); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? ""),
  });

  if (!isAdmin) {
    return <AnimatedPage><EmptyState icon={Megaphone} title="No access" description="Only admins can send announcements." /></AnimatedPage>;
  }
  const expired = (a: Announcement) => !!a.expires_at && new Date(a.expires_at).getTime() < Date.now();

  return (
    <AnimatedPage>
      <div className="mb-6">
        <h1 className="font-heading text-xl sm:text-[28px] font-bold text-ink-primary">Announcements</h1>
        <p className="text-sm text-ink-muted mt-0.5">Send a message that pops up on everyone's screen until they close it.</p>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-muted">Title *</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Office closed on Monday" maxLength={150} className="h-10" />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-muted">Message</label>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Write the announcement…" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-56">
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Show until (optional)</label>
            <Input type="date" value={until} min={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setUntil(e.target.value)} className="h-10" />
          </div>
          <Button className="gap-1.5 sm:ml-auto" disabled={post.isPending || !title.trim()} onClick={() => post.mutate()}>
            {post.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to everyone
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : error ? (
        <EmptyState icon={Megaphone} title="Announcements are not set up yet" description="Run TRILO_announcements.sql in Supabase, then reload." />
      ) : !data?.list.length ? (
        <EmptyState icon={Megaphone} title="No announcements yet" description="Your announcements will be listed here." />
      ) : (
        <div className="space-y-3">
          {data.list.map((a) => {
            const live = a.active && !expired(a);
            const seen = data.seen.get(a.id) ?? 0;
            return (
              <div key={a.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-heading text-sm font-bold text-ink-primary break-words">{a.title}</p>
                    <p className="text-xs text-ink-muted">
                      {data.names[a.created_by ?? ""] ?? "Admin"} · {format(new Date(a.created_at), "d MMM yyyy, h:mm a")}
                      {a.expires_at ? ` · until ${format(new Date(a.expires_at), "d MMM yyyy")}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${live ? "bg-success-light text-success" : "bg-muted text-ink-muted"}`}>
                    {live ? "Showing" : expired(a) ? "Expired" : "Stopped"}
                  </span>
                </div>
                {a.message && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-secondary">{a.message}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-ink-muted">
                    <Users className="h-3.5 w-3.5" /> Closed by {seen}{data.total ? ` of ${data.total}` : ""} people
                  </span>
                  {!expired(a) && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={toggle.isPending} onClick={() => toggle.mutate(a)}>
                      {a.active ? <><EyeOff className="h-4 w-4" /> Stop showing</> : <><Eye className="h-4 w-4" /> Show again</>}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive" disabled={remove.isPending}
                    onClick={() => { if (window.confirm(`Delete "${a.title}"?`)) remove.mutate(a.id); }}>
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AnimatedPage>
  );
}
