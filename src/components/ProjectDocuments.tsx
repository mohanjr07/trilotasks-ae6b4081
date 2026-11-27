// ─────────────────────────────────────────────────────────────────────────────
//  Project documents: folders, sub-folders and files for each project.
//  • Project members and admins create folders and upload files.
//  • A folder is open to everyone in the project, unless an admin restricts it
//    to chosen people (View or Edit). The restriction covers its sub-folders.
//  (TRILO_project_documents.sql)
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronRight, Download, FileText, Folder, FolderOpen, FolderPlus, Home, Loader2, Lock, Pencil, Shield, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { openFileLink } from "@/lib/nativeFiles";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilePickButtons } from "@/components/FilePick";
import { toast } from "sonner";

const sb = supabase as any;
const BUCKET = "project-docs";

export type DocMember = { user_id: string; name: string };
type FolderRow = { id: string; project_id: string; parent_id: string | null; name: string; restricted: boolean; created_by: string | null; created_at: string };
type FileRow = { id: string; folder_id: string; path: string; name: string; size: number | null; uploaded_by: string | null; created_at: string };
type AccessRow = { folder_id: string; user_id: string; can_edit: boolean };

const sizeText = (n: number | null) => n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const errText = (e: any) => {
  const m = e?.message ?? String(e ?? "");
  if (/does not exist|schema cache|project_folders|project_files/i.test(m) && !/row-level/i.test(m)) return "Documents aren't set up yet — run TRILO_project_documents.sql.";
  if (/row-level security|permission/i.test(m)) return "You don't have edit access to this folder.";
  return m;
};

function useDocs(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["project-docs", projectId],
    enabled,
    queryFn: async () => {
      const { data: folders, error } = await sb.from("project_folders").select("*").eq("project_id", projectId).order("name");
      if (error) return { error: errText(error), folders: [] as FolderRow[], files: [] as FileRow[], perms: {} as Record<string, number> };
      const ids = (folders ?? []).map((f: FolderRow) => f.id);
      const [files, perms] = await Promise.all([
        ids.length ? sb.from("project_files").select("*").in("folder_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
        sb.rpc("my_folder_perms", { p_project: projectId }),
      ]);
      const pm: Record<string, number> = {};
      for (const r of (perms.data ?? []) as Array<{ folder_id: string; perm: number }>) pm[r.folder_id] = r.perm;
      return { error: null as string | null, folders: (folders ?? []) as FolderRow[], files: (files.data ?? []) as FileRow[], perms: pm };
    },
  });
}

const openDoc = async (path: string) => {
  try {
    await openFileLink(async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    });
  } catch (e: any) { toast.error("Could not open the file: " + (e?.message ?? "")); }
};

/** The documents of one project. */
export default function ProjectDocumentsDialog({ open, onClose, projectId, projectName, members, isMember }: {
  open: boolean; onClose: () => void; projectId: string; projectName: string; members: DocMember[]; isMember: boolean;
}) {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useDocs(projectId, open);
  const [current, setCurrent] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<FolderRow | null>(null);
  const [accessFor, setAccessFor] = useState<FolderRow | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["project-docs", projectId] });

  const folders = data?.folders ?? [];
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const folder = current ? byId.get(current) ?? null : null;
  // a folder whose parent I can't see shows at the top level
  const children = folders.filter((f) => current ? f.parent_id === current : (!f.parent_id || !byId.has(f.parent_id)));
  const files = (data?.files ?? []).filter((f) => f.folder_id === current);
  const perm = (id: string | null) => id ? data?.perms[id] ?? 0 : (isAdmin || isMember ? 2 : 0);
  const canEditHere = perm(current) === 2;
  const name = (id: string | null) => members.find((m) => m.user_id === id)?.name ?? "—";
  const crumbs: FolderRow[] = [];
  for (let f = folder; f; f = f.parent_id ? byId.get(f.parent_id) ?? null : null) crumbs.unshift(f);
  const lockedHere = crumbs.some((c) => c.restricted);
  const countIn = (id: string) => folders.filter((f) => f.parent_id === id).length + (data?.files ?? []).filter((f) => f.folder_id === id).length;

  const createFolder = async () => {
    const n = (newName ?? "").trim();
    if (!n) return;
    setBusy(true);
    const { error } = await sb.from("project_folders").insert({ project_id: projectId, parent_id: current, name: n, created_by: user?.id });
    setBusy(false);
    if (error) return toast.error(errText(error));
    setNewName(null); refresh();
  };

  const rename = async (f: FolderRow, n: string) => {
    if (!n.trim()) return;
    const { error } = await sb.from("project_folders").update({ name: n.trim() }).eq("id", f.id);
    if (error) return toast.error(errText(error));
    setRenaming(null); refresh();
  };

  const upload = async (file: File) => {
    if (!current) return;
    setBusy(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${projectId}/${current}/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { error } = await sb.from("project_files").insert({ folder_id: current, path, name: file.name, size: file.size, mime: file.type || null, uploaded_by: user?.id });
      if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error; }
      toast.success("Uploaded " + file.name);
      refresh();
    } catch (e: any) { toast.error(errText(e)); }
    setBusy(false);
  };

  const deleteFile = async (f: FileRow) => {
    if (!confirm(`Delete "${f.name}"?`)) return;
    const { error } = await sb.from("project_files").delete().eq("id", f.id);
    if (error) return toast.error(errText(error));
    await supabase.storage.from(BUCKET).remove([f.path]);
    refresh();
  };

  const deleteFolder = async (f: FolderRow) => {
    // the folder, its sub-folders and every file in them
    const tree = new Set<string>([f.id]);
    let grew = true;
    while (grew) { grew = false; for (const x of folders) if (x.parent_id && tree.has(x.parent_id) && !tree.has(x.id)) { tree.add(x.id); grew = true; } }
    const paths = (data?.files ?? []).filter((x) => tree.has(x.folder_id)).map((x) => x.path);
    if (!confirm(`Delete the folder "${f.name}"` + (tree.size > 1 || paths.length ? ` with ${tree.size - 1} sub-folder(s) and ${paths.length} file(s)` : "") + "? This can't be undone.")) return;
    const { error } = await sb.from("project_folders").delete().eq("id", f.id);
    if (error) return toast.error(errText(error));
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    if (current && tree.has(current)) setCurrent(f.parent_id);
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" /> Documents</DialogTitle>
          <DialogDescription>{projectName} — folders and files for this project.</DialogDescription>
        </DialogHeader>

        {/* where am I */}
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => setCurrent(null)} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted ${!current ? "font-semibold text-ink-primary" : "text-ink-secondary"}`}>
            <Home className="h-3.5 w-3.5" /> All folders
          </button>
          {crumbs.map((c) => (
            <span key={c.id} className="inline-flex min-w-0 items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-ink-muted" />
              <button type="button" onClick={() => setCurrent(c.id)} className={`max-w-[10rem] truncate rounded px-1.5 py-0.5 hover:bg-muted ${c.id === current ? "font-semibold text-ink-primary" : "text-ink-secondary"}`}>{c.name}</button>
            </span>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-muted" /></div>
        ) : data?.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{data.error}</p>
        ) : (
          <div className="space-y-3">
            {folder && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-ink-secondary">
                {lockedHere ? <Lock className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                <span className="flex-1">{lockedHere ? "Only chosen people can open this folder." : "Everyone in the project can open this folder."}
                  {" "}You can {canEditHere ? "view and edit" : "only view"}.</span>
                {isAdmin && <Button size="sm" variant="outline" className="h-7" onClick={() => setAccessFor(folder)}><Shield className="mr-1 h-3.5 w-3.5" /> Access</Button>}
              </div>
            )}

            {canEditHere && (
              newName === null ? (
                <Button size="sm" variant="outline" onClick={() => setNewName("")}><FolderPlus className="mr-1.5 h-4 w-4" /> New {current ? "sub-folder" : "folder"}</Button>
              ) : (
                <div className="flex gap-2">
                  <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name (e.g. Drawings)"
                    onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setNewName(null); }} />
                  <Button size="sm" onClick={createFolder} disabled={busy || !newName.trim()}>Create</Button>
                  <Button size="sm" variant="ghost" onClick={() => setNewName(null)}>Cancel</Button>
                </div>
              )
            )}

            {/* folders */}
            {children.length > 0 && (
              <div className="divide-y divide-border rounded-md border border-border">
                {children.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 px-3 py-2">
                    {renaming?.id === f.id ? (
                      <RenameRow folder={f} onSave={(n) => rename(f, n)} onCancel={() => setRenaming(null)} />
                    ) : (
                      <>
                        <button type="button" onClick={() => setCurrent(f.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <Folder className="h-5 w-5 shrink-0 text-primary" />
                          <span className="min-w-0 truncate text-sm font-medium text-ink-primary">{f.name}</span>
                          {f.restricted && <Lock className="h-3 w-3 shrink-0 text-ink-muted" />}
                          <span className="shrink-0 text-xs text-ink-muted">{countIn(f.id) || ""}</span>
                        </button>
                        {perm(f.id) === 2 && (
                          <>
                            <button type="button" onClick={() => setRenaming(f)} className="p-1 text-ink-muted hover:text-ink-primary" aria-label="Rename"><Pencil className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => deleteFolder(f)} className="p-1 text-ink-muted hover:text-destructive" aria-label="Delete folder"><Trash2 className="h-3.5 w-3.5" /></button>
                          </>
                        )}
                        {isAdmin && <button type="button" onClick={() => setAccessFor(f)} className="p-1 text-ink-muted hover:text-ink-primary" aria-label="Access"><Shield className="h-3.5 w-3.5" /></button>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* files */}
            {current && (
              <>
                {canEditHere && (
                  <div className="space-y-1">
                    <p className="flex items-center gap-1 text-xs font-medium text-ink-secondary"><Upload className="h-3.5 w-3.5" /> Add a file {busy && <Loader2 className="h-3 w-3 animate-spin" />}</p>
                    <FilePickButtons onPick={upload} />
                  </div>
                )}
                {files.length > 0 && (
                  <div className="divide-y divide-border rounded-md border border-border">
                    {files.map((f) => (
                      <div key={f.id} className="flex items-center gap-2 px-3 py-2">
                        <button type="button" onClick={() => openDoc(f.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <FileText className="h-4 w-4 shrink-0 text-ink-muted" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink-primary">{f.name}</span>
                            <span className="block text-[11px] text-ink-muted">{[sizeText(f.size), name(f.uploaded_by), format(new Date(f.created_at), "d MMM yyyy")].filter((x) => x && x !== "—").join(" · ")}</span>
                          </span>
                        </button>
                        <button type="button" onClick={() => openDoc(f.path)} className="p-1 text-ink-muted hover:text-ink-primary" aria-label="Open"><Download className="h-3.5 w-3.5" /></button>
                        {canEditHere && <button type="button" onClick={() => deleteFile(f)} className="p-1 text-ink-muted hover:text-destructive" aria-label="Delete file"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {children.length === 0 && (!current || files.length === 0) && (
              <p className="py-6 text-center text-sm text-ink-muted">
                {current ? "This folder is empty." : canEditHere ? "No folders yet — create one to start adding documents." : "No folders yet."}
              </p>
            )}
          </div>
        )}

        {accessFor && <FolderAccessDialog folder={accessFor} members={members} onClose={() => setAccessFor(null)} onSaved={() => { setAccessFor(null); refresh(); }} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameRow({ folder, onSave, onCancel }: { folder: FolderRow; onSave: (n: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(folder.name);
  return (
    <div className="flex flex-1 gap-2">
      <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="h-8"
        onKeyDown={(e) => { if (e.key === "Enter") onSave(v); if (e.key === "Escape") onCancel(); }} />
      <Button size="sm" className="h-8" onClick={() => onSave(v)} disabled={!v.trim()}>Save</Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

/** Admins: who can open a folder (and its sub-folders). */
function FolderAccessDialog({ folder, members, onClose, onSaved }: { folder: FolderRow; members: DocMember[]; onClose: () => void; onSaved: () => void }) {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["project-folder-access", folder.id],
    queryFn: async () => {
      const { data } = await sb.from("project_folder_access").select("*").eq("folder_id", folder.id);
      return (data ?? []) as AccessRow[];
    },
  });
  const [restricted, setRestricted] = useState(folder.restricted);
  const [levels, setLevels] = useState<Record<string, "none" | "view" | "edit"> | null>(null);
  const lv = levels ?? Object.fromEntries((rows ?? []).map((r) => [r.user_id, r.can_edit ? "edit" : "view"])) as Record<string, "none" | "view" | "edit">;
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { error: e1 } = await sb.from("project_folder_access").delete().eq("folder_id", folder.id);
      if (e1) throw e1;
      const ins = Object.entries(lv).filter(([, l]) => l !== "none").map(([user_id, l]) => ({ folder_id: folder.id, user_id, can_edit: l === "edit" }));
      if (restricted && ins.length) { const { error } = await sb.from("project_folder_access").insert(ins); if (error) throw error; }
      if (restricted !== folder.restricted) {
        const { error } = await sb.from("project_folders").update({ restricted }).eq("id", folder.id);
        if (error) throw error;
      }
      toast.success("Access saved");
      onSaved();
    } catch (e: any) { toast.error(errText(e)); }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Access — {folder.name}</DialogTitle>
          <DialogDescription>Applies to this folder and its sub-folders. Admins always have access.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {[{ v: false, t: "Everyone in the project", d: "All project members can view and edit." }, { v: true, t: "Only chosen people", d: "Pick who can view or edit." }].map((o) => (
            <label key={String(o.v)} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${restricted === o.v ? "border-primary bg-primary/5" : "border-border"}`}>
              <input type="radio" className="mt-1" checked={restricted === o.v} onChange={() => setRestricted(o.v)} />
              <span><span className="block text-sm font-medium text-ink-primary">{o.t}</span><span className="block text-xs text-ink-muted">{o.d}</span></span>
            </label>
          ))}
        </div>
        {restricted && (
          isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-muted" /> : (
            <div className="divide-y divide-border rounded-md border border-border">
              {members.length === 0 && <p className="p-3 text-sm text-ink-muted">No members in this project yet.</p>}
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  <select value={lv[m.user_id] ?? "none"} onChange={(e) => setLevels({ ...lv, [m.user_id]: e.target.value as any })}
                    className="h-8 rounded-md border border-border bg-background px-2 text-sm">
                    <option value="none">No access</option>
                    <option value="view">View</option>
                    <option value="edit">Edit</option>
                  </select>
                </div>
              ))}
            </div>
          )
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
