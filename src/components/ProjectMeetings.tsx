// ─────────────────────────────────────────────────────────────────────────────
//  Project meetings with MOM (minutes of meeting).
//  • Every project starts with one Kickoff meeting; daily meetings follow it.
//  • Each meeting: date, MOM text, attendees, action points (what / who / by
//    when / done) and attachments (photos, files).
//  • Project members and admins add meetings and write the MOM.
//  (TRILO_project_meetings.sql)
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, CheckCircle2, ChevronRight, Circle, FileText, Flag, Loader2, Paperclip, Plus, Trash2, Users, X, ListChecks, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { openFileLink } from "@/lib/nativeFiles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FilePickButtons, PickedFile } from "@/components/FilePick";
import { toast } from "sonner";

const sb = supabase as any;
const BUCKET = "meeting-files";
const today = () => format(new Date(), "yyyy-MM-dd");

export type Member = { user_id: string; name: string };
type Meeting = { id: string; project_id: string; kind: "kickoff" | "daily"; meeting_date: string; title: string | null; mom: string; created_by: string | null; created_at: string; updated_at: string };
type Action = { id?: string; meeting_id?: string; text: string; owner_id: string | null; due_date: string | null; done: boolean };
type MFile = { id: string; meeting_id: string; path: string; name: string | null };

function useMeetings(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["project-meetings", projectId],
    enabled,
    queryFn: async () => {
      const { data: meetings, error } = await sb.from("project_meetings").select("*").eq("project_id", projectId)
        .order("meeting_date", { ascending: false }).order("created_at", { ascending: false });
      if (error) return { missing: /project_meetings/.test(error.message ?? ""), meetings: [] as Meeting[], attendees: [], actions: [] as Action[], files: [] as MFile[] };
      const ids = (meetings ?? []).map((m: Meeting) => m.id);
      const [a, ac, f] = ids.length ? await Promise.all([
        sb.from("project_meeting_attendees").select("*").in("meeting_id", ids),
        sb.from("project_meeting_actions").select("*").in("meeting_id", ids).order("created_at"),
        sb.from("project_meeting_files").select("*").in("meeting_id", ids).order("created_at"),
      ]) : [{ data: [] }, { data: [] }, { data: [] }];
      return { missing: false, meetings: (meetings ?? []) as Meeting[], attendees: (a.data ?? []) as Array<{ meeting_id: string; user_id: string }>,
        actions: (ac.data ?? []) as Action[], files: (f.data ?? []) as MFile[] };
    },
  });
}

const openFile = async (path: string) => {
  try {
    await openFileLink(async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    });
  } catch (e: any) { toast.error("Could not open the file: " + (e?.message ?? "")); }
};

/** All meetings of one project. */
export default function ProjectMeetingsDialog({ open, onClose, projectId, projectName, members }: {
  open: boolean; onClose: () => void; projectId: string; projectName: string; members: Member[];
}) {
  const { data, isLoading } = useMeetings(projectId, open);
  const [editing, setEditing] = useState<{ meeting: Meeting | null; kind: Meeting["kind"] } | null>(null);
  const meetings = data?.meetings ?? [];
  const kickoff = meetings.find((m) => m.kind === "kickoff");
  const name = (id: string | null) => members.find((m) => m.user_id === id)?.name ?? "—";
  const openActions = (data?.actions ?? []).filter((a) => !a.done);
  const todayDone = meetings.some((m) => m.kind === "daily" && m.meeting_date === today());

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Meetings</DialogTitle>
          <DialogDescription>{projectName} — kickoff, daily meetings and their MOM.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></div>
        ) : data?.missing ? (
          <p className="rounded-lg border border-warning/40 bg-warning-light p-3 text-sm text-warning">Meetings aren't set up yet — run TRILO_project_meetings.sql.</p>
        ) : (
          <div className="space-y-4">
            {!kickoff ? (
              <div className="rounded-xl border border-dashed border-primary/40 bg-accent-light/30 p-4 text-center">
                <Flag className="mx-auto mb-2 h-6 w-6 text-primary" />
                <p className="text-sm font-semibold text-ink-primary">Start with the kickoff meeting</p>
                <p className="mb-3 text-xs text-ink-muted">Daily meetings can be added once the kickoff MOM is recorded.</p>
                <Button className="gap-1.5" onClick={() => setEditing({ meeting: null, kind: "kickoff" })}><Plus className="h-4 w-4" /> Add kickoff meeting</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button className="gap-1.5" onClick={() => setEditing({ meeting: null, kind: "daily" })}>
                  <Plus className="h-4 w-4" /> {todayDone ? "Add another meeting" : "Add today's meeting"}
                </Button>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${todayDone ? "bg-success-light text-success" : "bg-warning-light text-warning"}`}>
                  {todayDone ? "Today's MOM recorded" : "No MOM for today yet"}
                </span>
              </div>
            )}

            {openActions.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"><ListChecks className="h-3.5 w-3.5" /> Open action points ({openActions.length})</p>
                <ActionList actions={openActions} name={name} projectId={projectId} />
              </div>
            )}

            <div className="space-y-2">
              {meetings.map((m) => {
                const att = (data?.attendees ?? []).filter((a) => a.meeting_id === m.id).length;
                const acts = (data?.actions ?? []).filter((a) => a.meeting_id === m.id);
                const files = (data?.files ?? []).filter((f) => f.meeting_id === m.id).length;
                return (
                  <button key={m.id} type="button" onClick={() => setEditing({ meeting: m, kind: m.kind })}
                    className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/40 ${m.kind === "kickoff" ? "border-primary/40 bg-accent-light/20" : "border-border bg-card"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.kind === "kickoff" ? "bg-primary text-primary-foreground" : "bg-muted text-ink-secondary"}`}>
                        {m.kind === "kickoff" ? "Kickoff" : "Daily"}
                      </span>
                      <span className="text-sm font-semibold text-ink-primary">{format(new Date(m.meeting_date), "EEE, d MMM yyyy")}</span>
                      {m.title && <span className="min-w-0 truncate text-sm text-ink-secondary">· {m.title}</span>}
                      <ChevronRight className="ml-auto h-4 w-4 text-ink-muted" />
                    </div>
                    <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-sm text-ink-secondary">{m.mom}</p>
                    <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-muted">
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {att} attended</span>
                      {acts.length > 0 && <span className="inline-flex items-center gap-1"><ListChecks className="h-3 w-3" /> {acts.filter((a) => a.done).length}/{acts.length} actions done</span>}
                      {files > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> {files} file{files === 1 ? "" : "s"}</span>}
                      <span>· by {name(m.created_by)}</span>
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {editing && (
          <MeetingEditor projectId={projectId} members={members} meeting={editing.meeting} kind={editing.kind}
            attendees={(data?.attendees ?? []).filter((a) => a.meeting_id === editing.meeting?.id).map((a) => a.user_id)}
            actions={(data?.actions ?? []).filter((a) => a.meeting_id === editing.meeting?.id)}
            files={(data?.files ?? []).filter((f) => f.meeting_id === editing.meeting?.id)}
            onClose={() => setEditing(null)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ActionList({ actions, name, projectId }: { actions: Action[]; name: (id: string | null) => string; projectId: string }) {
  const qc = useQueryClient();
  const toggle = async (a: Action) => {
    const { error } = await sb.from("project_meeting_actions").update({ done: !a.done, done_at: !a.done ? new Date().toISOString() : null }).eq("id", a.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["project-meetings", projectId] });
  };
  return (
    <div className="space-y-1.5">
      {actions.map((a) => {
        const late = !a.done && a.due_date && a.due_date < today();
        return (
          <div key={a.id} className="flex items-start gap-2 text-sm">
            <button type="button" onClick={() => toggle(a)} aria-label={a.done ? "Mark not done" : "Mark done"} className="mt-0.5 shrink-0">
              {a.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-ink-muted" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`break-words ${a.done ? "text-ink-muted line-through" : "text-ink-primary"}`}>{a.text}</p>
              <p className={`text-[11px] ${late ? "font-semibold text-destructive" : "text-ink-muted"}`}>
                {a.owner_id ? name(a.owner_id) : "No owner"}{a.due_date ? ` · by ${format(new Date(a.due_date), "d MMM")}` : ""}{late ? " · overdue" : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Add / edit one meeting: date, MOM, attendees, action points, files. */
function MeetingEditor({ projectId, members, meeting, kind, attendees, actions, files, onClose }: {
  projectId: string; members: Member[]; meeting: Meeting | null; kind: Meeting["kind"];
  attendees: string[]; actions: Action[]; files: MFile[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth() as any;
  const [date, setDate] = useState(meeting?.meeting_date ?? today());
  const [title, setTitle] = useState(meeting?.title ?? "");
  const [mom, setMom] = useState(meeting?.mom ?? "");
  const [who, setWho] = useState<Set<string>>(() => new Set(meeting ? attendees : user?.id ? [user.id] : []));
  const [acts, setActs] = useState<Action[]>(() => actions.map((a) => ({ ...a })));
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [removedFiles, setRemovedFiles] = useState<MFile[]>([]);
  const [saving, setSaving] = useState(false);
  const shownFiles = useMemo(() => files.filter((f) => !removedFiles.some((r) => r.id === f.id)), [files, removedFiles]);

  const toggleWho = (id: string) => setWho((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setAct = (i: number, patch: Partial<Action>) => setActs(acts.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const save = async () => {
    if (!mom.trim()) { toast.error("Write the MOM"); return; }
    if (acts.some((a) => !a.text.trim())) { toast.error("Fill in or remove the empty action point"); return; }
    setSaving(true);
    try {
      const row = { project_id: projectId, kind, meeting_date: date || today(), title: title.trim() || null, mom: mom.trim() };
      const res = meeting
        ? await sb.from("project_meetings").update(row).eq("id", meeting.id).select("id").single()
        : await sb.from("project_meetings").insert(row).select("id").single();
      if (res.error) {
        const m = res.error.message ?? "";
        throw new Error(/kickoff_first/i.test(m) ? "Add the kickoff meeting first"
          : /one_kickoff|duplicate/i.test(m) ? (kind === "kickoff" ? "This project already has a kickoff meeting" : "There's already a daily meeting on that date — open it to edit")
          : /project_meetings/.test(m) && /exist|schema/.test(m) ? "Run TRILO_project_meetings.sql first" : m);
      }
      const id = res.data.id as string;
      // attendees
      await sb.from("project_meeting_attendees").delete().eq("meeting_id", id);
      if (who.size) {
        const { error } = await sb.from("project_meeting_attendees").insert([...who].map((u) => ({ meeting_id: id, user_id: u })));
        if (error) throw error;
      }
      // action points
      const keep = acts.filter((a) => a.id).map((a) => a.id);
      const gone = actions.filter((a) => !keep.includes(a.id));
      if (gone.length) await sb.from("project_meeting_actions").delete().in("id", gone.map((a) => a.id));
      for (const a of acts) {
        const r = { meeting_id: id, text: a.text.trim(), owner_id: a.owner_id || null, due_date: a.due_date || null, done: a.done,
          done_at: a.done ? (a as any).done_at ?? new Date().toISOString() : null };
        const { error } = a.id ? await sb.from("project_meeting_actions").update(r).eq("id", a.id) : await sb.from("project_meeting_actions").insert(r);
        if (error) throw error;
      }
      // files
      for (const f of removedFiles) {
        await sb.from("project_meeting_files").delete().eq("id", f.id);
        supabase.storage.from(BUCKET).remove([f.path]).catch(() => {});
      }
      for (const f of newFiles) {
        if (f.size > 25 * 1024 * 1024) { toast.error(`${f.name} is larger than 25 MB — skipped`); continue; }
        const path = `${projectId}/${id}/${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined });
        if (upErr) throw upErr;
        const { error } = await sb.from("project_meeting_files").insert({ meeting_id: id, path, name: f.name });
        if (error) throw error;
      }
      toast.success(meeting ? "Meeting updated" : kind === "kickoff" ? "Kickoff meeting saved" : "Meeting saved");
      qc.invalidateQueries({ queryKey: ["project-meetings", projectId] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!meeting || !window.confirm(`Delete this ${kind === "kickoff" ? "kickoff " : ""}meeting and its MOM?`)) return;
    const { error } = await sb.from("project_meetings").delete().eq("id", meeting.id);
    if (error) { toast.error(/kickoff_in_use/i.test(error.message) ? "Delete the daily meetings first — they follow the kickoff" : error.message); return; }
    if (files.length) supabase.storage.from(BUCKET).remove(files.map((f) => f.path)).catch(() => {});
    qc.invalidateQueries({ queryKey: ["project-meetings", projectId] });
    toast.success("Meeting deleted");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === "kickoff" ? <Flag className="h-5 w-5 text-primary" /> : <CalendarDays className="h-5 w-5" />}
            {meeting ? (kind === "kickoff" ? "Kickoff meeting" : "Daily meeting") : kind === "kickoff" ? "New kickoff meeting" : "New daily meeting"}
          </DialogTitle>
          <DialogDescription>Write the MOM — what was discussed and decided.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted">Topic (optional)</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "kickoff" ? "e.g. Project kickoff" : "e.g. Site progress"} className="h-10" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">MOM — minutes of meeting *</label>
          <Textarea value={mom} onChange={(e) => setMom(e.target.value)} rows={7}
            placeholder={"• Points discussed\n• Decisions taken\n• Next steps"} />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-muted">Attendees ({who.size})</p>
          {members.length ? (
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <button key={m.user_id} type="button" onClick={() => toggleWho(m.user_id)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${who.has(m.user_id) ? "border-primary bg-accent-light text-primary" : "border-border text-ink-secondary hover:bg-muted"}`}>
                  {who.has(m.user_id) ? "✓ " : ""}{m.name}
                </button>
              ))}
            </div>
          ) : <p className="text-xs text-ink-muted">No members in this project yet — add them under Projects.</p>}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-ink-muted">Action points ({acts.length})</p>
            <button type="button" onClick={() => setActs([...acts, { text: "", owner_id: null, due_date: null, done: false }])}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Add action</button>
          </div>
          <div className="space-y-2">
            {acts.map((a, i) => (
              <div key={a.id ?? `new-${i}`} className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
                <div className="flex items-start gap-2">
                  <button type="button" onClick={() => setAct(i, { done: !a.done })} className="mt-2.5 shrink-0" aria-label="Done">
                    {a.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-ink-muted" />}
                  </button>
                  <Input value={a.text} onChange={(e) => setAct(i, { text: e.target.value })} placeholder="What needs to be done" className="h-10 flex-1" />
                  <button type="button" onClick={() => setActs(acts.filter((_, j) => j !== i))} className="mt-2.5 text-ink-muted hover:text-destructive" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-2 gap-2 pl-6">
                  <select value={a.owner_id ?? ""} onChange={(e) => setAct(i, { owner_id: e.target.value || null })}
                    className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-xs">
                    <option value="">Who…</option>
                    {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
                  </select>
                  <Input type="date" value={a.due_date ?? ""} onChange={(e) => setAct(i, { due_date: e.target.value || null })} className="h-9 text-xs" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-muted">Attachments</p>
          <div className="space-y-2">
            {shownFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-ink-muted" />
                <button type="button" onClick={() => openFile(f.path)} className="min-w-0 flex-1 truncate text-left hover:underline">{f.name ?? "file"}</button>
                <button type="button" onClick={() => setRemovedFiles([...removedFiles, f])} className="text-ink-muted hover:text-destructive" aria-label="Remove"><X className="h-4 w-4" /></button>
              </div>
            ))}
            {newFiles.map((f, i) => <PickedFile key={i} file={f} onRemove={() => setNewFiles(newFiles.filter((_, j) => j !== i))} />)}
            <FilePickButtons onPick={(f) => setNewFiles((l) => [...l, f])} />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {meeting && <Button variant="outline" className="mr-auto gap-1.5 text-destructive" disabled={saving} onClick={remove}><Trash2 className="h-4 w-4" /> Delete</Button>}
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Save MOM</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
