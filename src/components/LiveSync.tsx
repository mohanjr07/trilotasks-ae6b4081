// ─────────────────────────────────────────────────────────────────────────────
//  Live updates without polling.
//  Every device keeps ONE realtime connection to the database. When a row
//  changes, only the screens that show that table refresh (not the whole app),
//  and nothing refreshes while the app is in the background — it catches up the
//  moment it comes back. This keeps phones (iPhone home-screen app) fast.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// which screens (query keys) read which table
const TABLE_KEYS: Array<[RegExp, RegExp]> = [
  [/^(tasks|task_assignees|task_comments|task_attachments|task_columns|user_task_columns|user_task_column_prefs)$/, /task|calendar|report|completed|intern|pending-counts|project-of-task/],
  [/^(form_requests|production_forms|production_form_opens)$/, /form|pending-counts/],
  [/^payment_requests$/, /payment|expense|pending-counts/],
  [/^(leave_requests|leave_policy|holidays)$/, /leave|holiday|calendar|people|pending-counts|birthday/],
  [/^(overtime_entries|overtime_members)$/, /^ot-|overtime|pending-counts/],
  [/^(notifications|notification_preferences)$/, /notif/],
  [/^(projects|project_members|project_teams)$/, /project|task|payment|expense|^pp-/],
  [/^profiles$/, /profile|people|user|employee|member|intern|team|birthday|kra|docs|form-people|payment-people|ot-|pp-people|all-|names/],
  [/^assets$/, /asset/],
  [/^user_documents$/, /doc/],
  [/^(team_meetings|team_meeting_participants)$/, /meeting|team/],
  [/^kra_kpi$/, /kra/],
  [/^organisation_flow_nodes$/, /organisation/],
  [/^user_notes$/, /note/],
  [/^(attendance|daily_summary|weekly_attendance|monthly_attendance)$/, /attendance/],
  [/^pp_/, /^pp-|pending-counts/],
];

export default function LiveSync() {
  const qc = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    let timer: number | undefined;
    const pending = new Set<string>();      // tables changed since the last refresh
    let everything = false;

    const flush = () => {
      if (document.visibilityState === "hidden") return;   // catch up when the app is opened again
      const tables = Array.from(pending);
      const all = everything;
      pending.clear(); everything = false;
      if (!tables.length && !all) return;
      const keyRes = tables.flatMap((t) => TABLE_KEYS.filter(([tr]) => tr.test(t)).map(([, kr]) => kr));
      const unknown = tables.some((t) => !TABLE_KEYS.some(([tr]) => tr.test(t)));
      qc.invalidateQueries({
        predicate: (q: Query) => {
          const k = String(q.queryKey[0] ?? "");
          if (k === "form-template") return false;                 // Word templates never change here
          if (all || unknown) return true;
          return keyRes.some((re) => re.test(k));
        },
      });
    };
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(flush, 800); };

    const channel = supabase
      .channel(`live-sync-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: any) => {
        if (payload?.table) pending.add(String(payload.table)); else everything = true;
        schedule();
      })
      .subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") flush(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [qc, user]);

  return null;
}
