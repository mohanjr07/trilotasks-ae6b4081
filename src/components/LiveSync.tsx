// ─────────────────────────────────────────────────────────────────────────────
//  Live updates without polling.
//  Every device keeps ONE realtime connection to the database. When any row
//  changes (new task, form approved, payment paid…), the screens refresh within
//  about a second. This replaces the old "refresh every 5 seconds", which sent
//  so many requests through the website relay that it hit Cloudflare's daily
//  limit and requests started failing ("Failed to fetch").
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function LiveSync() {
  const qc = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      // a burst of changes → one refresh; Word templates are never re-downloaded
      timer = window.setTimeout(() => {
        qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "form-template" });
      }, 700);
    };
    const channel = supabase
      .channel(`live-sync-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public" }, refresh)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [qc, user]);

  return null;
}
