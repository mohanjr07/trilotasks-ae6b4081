// ─────────────────────────────────────────────────────────────────────────────
//  Overtime — admins keep the list of OT members; managers enter overtime for
//  them (many at once) and every entry is sent to anu@triloautomation.com.
//  Only admins, managers and Anu can open this page.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Timer, Plus, ShieldCheck, Trash2, Search, Check, X, Loader2, Users, Download, Camera, ImagePlus, Image as ImageIcon } from "lucide-react";
import { saveFile } from "@/lib/nativeFiles";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

export const OVERTIME_VIEWER_EMAILS = ["anu@triloautomation.com"];
const OT_APPROVER_EMAIL = "hari@triloautomation.com";

/** Admins, managers and Anu. */
export function canSeeOvertime(profile: { role?: string | null; email?: string | null } | null | undefined) {
  if (!profile) return false;
  return ["admin", "super_admin", "manager"].includes(profile.role ?? "")
    || OVERTIME_VIEWER_EMAILS.includes((profile.email ?? "").toLowerCase());
}

type Entry = {
  id: string;
  work_date: string;
  employee_id: string;
  half: "first" | "second" | "full" | "other";
  duration_hours: number;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
  verified_by: string | null;
  verified_at: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
  reject_reason?: string | null;
  photo_paths?: string[] | null;
};
/** waiting for Hari: not approved and not rejected */
const isPendingOt = (e: { verified_at: string | null; rejected_at?: string | null }) => !e.verified_at && !e.rejected_at;
type Person = { id: string; full_name: string; role: string };

const halfLabel = (h: string) =>
  h === "full" ? "Full day" : h === "other" ? "Other time" : h === "first" ? "First half" : "Second half";
const FULL_DAY_MIN = 9 * 60;   // a full day of overtime counts as 9 hours
const hours = (n: number) => `${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })} h`;
const todayIso = () => format(new Date(), "yyyy-MM-dd");
const PHOTO_BUCKET = "overtime-photos";

/** Shrink a phone photo (max 1600px, JPEG) so it uploads quickly; falls back to the original. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export default function OvertimePage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const allowed = canSeeOvertime(profile as any);
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const canVerify = isAdmin || profile?.role === "manager";          // can enter overtime
  // Hari approves overtime entered by anyone else; his own entries go straight to Anu
  const isHari = (profile?.email ?? "").toLowerCase() === OT_APPROVER_EMAIL;
  const canApprove = isHari;
  const anuOnly = !canVerify;                                          // Anu sees approved entries only
  // admins and Anu can download overtime as Excel
  const canExport = isAdmin || OVERTIME_VIEWER_EMAILS.includes((profile?.email ?? "").toLowerCase());
  const [exportOpen, setExportOpen] = useState(false);

  const [tab, setTab] = useState<"pending" | "verified" | "rejected" | "all">("all");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  const { data: people = [] } = useQuery({
    queryKey: ["ot-people"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_profiles");
      if (error) throw error;
      return ((data ?? []) as Person[]).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
    enabled: allowed,
    staleTime: 5 * 60 * 1000,
  });
  // people the admin has dedicated to overtime
  const { data: memberIds = [] } = useQuery({
    queryKey: ["ot-members"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("overtime_members").select("employee_id");
      if (error) throw error;
      return ((data ?? []) as Array<{ employee_id: string }>).map((m) => m.employee_id);
    },
    enabled: allowed,
  });
  const members = people.filter((p) => memberIds.includes(p.id));
  const nameOf = (id?: string | null) => (id ? people.find((p) => p.id === id)?.full_name ?? "—" : "—");

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["overtime"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("overtime_entries").select("*")
        .order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as Entry[];
    },
    enabled: allowed,
  });

  // live updates when someone adds / verifies
  useEffect(() => {
    if (!allowed) return;
    const ch = supabase.channel("overtime-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "overtime_entries" }, () =>
        qc.invalidateQueries({ queryKey: ["overtime"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [allowed, qc]);

  const verify = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await (supabase as any).rpc("verify_overtime", { p_ids: ids });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["overtime"] });
      setPicked(new Set());
      toast.success(`${n} ${n === 1 ? "entry" : "entries"} approved — Anu has been notified`);
    },
    onError: (e: any) => toast.error("Could not verify: " + (e?.message ?? "")),
  });

  // Hari: reject with a reason (the person who entered it is notified)
  const [photoPaths, setPhotoPaths] = useState<string[] | null>(null);
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const reject = useMutation({
    mutationFn: async (a: { ids: string[]; reason: string }) => {
      const { data, error } = await (supabase as any).rpc("reject_overtime", { p_ids: a.ids, p_reason: a.reason });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["overtime"] });
      setPicked(new Set()); setRejectIds(null); setRejectReason("");
      toast.success(`${n} ${n === 1 ? "entry" : "entries"} rejected — the person who entered it has been told`);
    },
    onError: (e: any) => toast.error("Could not reject: " + (e?.message ?? "")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).from("overtime_entries").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("not allowed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["overtime"] }); toast.success("Entry removed"); },
    onError: (e: any) => toast.error("Could not remove: " + (e?.message ?? "")),
  });

  const q = search.trim().toLowerCase();
  const list = entries.filter((e) => !(anuOnly && !e.verified_at)).filter((e) =>
    (tab === "all" || (tab === "pending" ? isPendingOt(e) : tab === "rejected" ? !!e.rejected_at : !!e.verified_at)) &&
    (!q || nameOf(e.employee_id).toLowerCase().includes(q)));

  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of list) m.set(e.work_date, [...(m.get(e.work_date) ?? []), e]);
    return Array.from(m.entries());
  }, [list]);

  const pendingCount = anuOnly ? 0 : entries.filter(isPendingOt).length;
  const rejectedCount = anuOnly ? 0 : entries.filter((e) => !!e.rejected_at).length;
  const pendingPicked = Array.from(picked).filter((id) => entries.find((e) => e.id === id && isPendingOt(e)));
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (!allowed) {
    return (
      <AnimatedPage>
        <EmptyState icon={Timer} title="No access" description="Overtime is only available to managers, admins and HR." />
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-xl sm:text-[28px] font-bold text-ink-primary">Overtime</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {isHari ? "Approve or reject the overtime entered by others — approved entries go to Anu. Your own entries go to Anu straight away."
              : isAdmin ? "Set the OT members; overtime entered goes to Hari for approval, then to Anu."
              : canVerify ? "Enter overtime for the OT members — Hari approves it, then it goes to Anu."
              : "Overtime entered by the managers."}
          </p>
        </div>
        <div className="flex gap-2">
          {canApprove && pendingPicked.length > 0 && (
            <Button variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={reject.isPending}
              onClick={() => { setRejectReason(""); setRejectIds(pendingPicked); }}>
              <X className="h-4 w-4" /> Reject selected ({pendingPicked.length})
            </Button>
          )}
          {canApprove && pendingPicked.length > 0 && (
            <Button variant="outline" className="gap-1.5" disabled={verify.isPending} onClick={() => verify.mutate(pendingPicked)}>
              <ShieldCheck className="h-4 w-4" /> Approve selected ({pendingPicked.length})
            </Button>
          )}
          {canExport && (
            <Button variant="outline" className="gap-1.5" onClick={() => setExportOpen(true)}>
              <Download className="h-4 w-4" /> Excel
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" className="gap-1.5" onClick={() => setMembersOpen(true)}>
              <Users className="h-4 w-4" /> OT members ({members.length})
            </Button>
          )}
          {canVerify && (
            <Button className="gap-1.5" onClick={() => (members.length ? setAddOpen(true) : isAdmin ? setMembersOpen(true) : toast.error("No OT members yet — ask an admin to add them."))}>
              <Plus className="h-4 w-4" /> Add overtime
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className={`flex gap-1 border-b border-border ${pendingCount || rejectedCount ? "" : "invisible"}`}>
          {([["pending", `Waiting for Hari's approval${pendingCount ? ` (${pendingCount})` : ""}`], ["verified", "Approved"], ...(rejectedCount ? [["rejected", `Rejected (${rejectedCount})`]] : []), ["all", "All"]] as Array<[typeof tab, string]>).map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setPicked(new Set()); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === k ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name" className="h-9 pl-9" />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : byDate.length === 0 ? (
        <EmptyState icon={Timer}
          title={tab === "pending" ? "Nothing waiting for approval" : "No overtime entries"}
          description={isAdmin && !members.length ? "First add the people dedicated to overtime under “OT members”."
            : canVerify ? (members.length ? "Click “Add overtime” to enter overtime for one or more people." : "No OT members yet — an admin needs to add them first.")
            : "New entries will appear here."} />
      ) : (
        <div className="space-y-5">
          {byDate.map(([date, rows]) => {
            const dayPending = rows.filter(isPendingOt).map((r) => r.id);
            const total = rows.filter((r) => !r.rejected_at).reduce((s, r) => s + Number(r.duration_hours), 0);
            return (
              <div key={date} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <p className="text-sm font-semibold text-ink-primary">
                    {format(new Date(date + "T00:00:00"), "EEE, d MMM yyyy")}
                    <span className="ml-2 font-normal text-ink-muted">{rows.length} {rows.length === 1 ? "person" : "people"} · {hours(total)}</span>
                  </p>
                  {canApprove && dayPending.length > 0 && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={verify.isPending} onClick={() => verify.mutate(dayPending)}>
                      <ShieldCheck className="h-4 w-4" /> Approve all ({dayPending.length})
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-border">
                  {rows.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      {canApprove && isPendingOt(r) && (
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} aria-label="Select" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-primary truncate">{nameOf(r.employee_id)}</p>
                        <p className="text-xs text-ink-muted">
                          Entered by {nameOf(r.created_by)}{r.note ? ` · ${r.note}` : ""}
                        </p>
                      </div>
                      {!!r.photo_paths?.length && (
                        <button type="button" onClick={() => setPhotoPaths(r.photo_paths!)}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-muted">
                          <ImageIcon className="h-3.5 w-3.5" /> {r.photo_paths!.length}
                        </button>
                      )}
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-ink-secondary">{halfLabel(r.half)}</span>
                      {r.start_time && r.end_time && (
                        <span className="text-xs text-ink-secondary whitespace-nowrap">{fmtTime(r.start_time)} – {fmtTime(r.end_time)}</span>
                      )}
                      <span className="w-20 text-right font-heading text-sm font-bold text-ink-primary">{r.start_time && r.end_time ? fmtSpan(spanMin(r.start_time.slice(0, 5), r.end_time.slice(0, 5))) : hours(r.duration_hours)}</span>
                      {r.verified_at ? (
                        <span className="text-xs text-success text-right min-w-[150px]">
                          {r.verified_by === r.created_by ? "✓ Sent to Anu" : `✓ Approved by ${nameOf(r.verified_by)} · sent to Anu`}
                          <span className="block text-ink-muted">{format(new Date(r.verified_at), "d MMM, h:mm a")}</span>
                        </span>
                      ) : r.rejected_at ? (
                        <span className="text-xs text-destructive text-right min-w-[150px] max-w-[260px]">
                          ✗ Rejected by {nameOf(r.rejected_by)}
                          <span className="block text-ink-muted">{format(new Date(r.rejected_at), "d MMM, h:mm a")}{r.reject_reason ? ` · ${r.reject_reason}` : ""}</span>
                        </span>
                      ) : canApprove ? (
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive" disabled={reject.isPending}
                            onClick={() => { setRejectReason(""); setRejectIds([r.id]); }}>
                            <X className="h-4 w-4" /> Reject
                          </Button>
                          <Button size="sm" className="h-8 gap-1.5 min-w-[110px]" disabled={verify.isPending} onClick={() => verify.mutate([r.id])}>
                            <ShieldCheck className="h-4 w-4" /> Approve
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-warning min-w-[110px] text-right">Waiting for Hari's approval</span>
                      )}
                      {isAdmin && (
                        <button onClick={() => { if (window.confirm(`Remove ${nameOf(r.employee_id)}'s overtime on ${date}?`)) remove.mutate(r.id); }}
                          className="rounded-md p-1.5 text-ink-muted hover:text-destructive hover:bg-destructive/10" title="Remove" aria-label="Remove">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <OvertimePhotosDialog paths={photoPaths} onClose={() => setPhotoPaths(null)} />

      <Dialog open={!!rejectIds} onOpenChange={(o) => !o && setRejectIds(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject overtime{rejectIds && rejectIds.length > 1 ? ` (${rejectIds.length} entries)` : ""}</DialogTitle>
            <DialogDescription>It won't go to Anu. The person who entered it gets your reason.</DialogDescription>
          </DialogHeader>
          <label htmlFor="ot-reject" className="text-sm font-medium text-ink-primary">Reason *</label>
          <textarea id="ot-reject" rows={3} autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Not approved in advance / wrong hours"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setRejectIds(null)}>Cancel</Button>
            <Button variant="destructive" disabled={reject.isPending}
              onClick={() => (rejectReason.trim() ? rejectIds && reject.mutate({ ids: rejectIds, reason: rejectReason.trim() }) : toast.error("Give a reason"))}>
              {reject.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {canExport && <OvertimeExportDialog open={exportOpen} onClose={() => setExportOpen(false)} nameOf={nameOf} approvedOnly={anuOnly} />}

      {canVerify && (
        <AddOvertimeDialog isHari={isHari} open={addOpen} onClose={() => setAddOpen(false)} people={members} userId={user?.id ?? ""}
          onDone={() => qc.invalidateQueries({ queryKey: ["overtime"] })} />
      )}
      {isAdmin && (
        <OvertimeMembersDialog open={membersOpen} onClose={() => setMembersOpen(false)} people={people} memberIds={memberIds}
          onChanged={() => qc.invalidateQueries({ queryKey: ["ot-members"] })} />
      )}
    </AnimatedPage>
  );
}

/** "18:30" → minutes since midnight */
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
/** worked minutes between two times (an end before the start means it ran past midnight) */
const spanMin = (start: string, end: string) => {
  if (!start || !end) return 0;
  let d = toMin(end) - toMin(start);
  if (d <= 0) d += 24 * 60;
  return d;
};
const fmtSpan = (min: number) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : "—");
export const fmtTime = (t?: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

type Row = { half: "full" | "other" | ""; start: string; end: string };
const rowMin = (r?: Row) => (!r ? 0 : r.half === "full" ? FULL_DAY_MIN : r.half === "other" ? spanMin(r.start, r.end) : 0);

function OvertimePhotosDialog({ paths, onClose }: { paths: string[] | null; onClose: () => void }) {
  const { data: urls = [], isLoading } = useQuery({
    queryKey: ["ot-photos", paths],
    queryFn: async () => {
      const out: string[] = [];
      for (const p of paths ?? []) {
        const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(p, 3600);
        if (data?.signedUrl) out.push(data.signedUrl);
      }
      return out;
    },
    enabled: !!paths?.length,
    staleTime: 30 * 60 * 1000,
  });
  return (
    <Dialog open={!!paths} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Overtime photos</DialogTitle>
          <DialogDescription>Tap a photo to open it full size.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-ink-muted" /></div>
        ) : urls.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {urls.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border">
                <img src={u} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
              </a>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-ink-muted">Couldn't load the photos.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddOvertimeDialog({ open, onClose, people, onDone, isHari, userId }: {
  isHari?: boolean;
  open: boolean; onClose: () => void; people: Person[]; userId?: string; onDone: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [note, setNote] = useState("");
  const [find, setFind] = useState("");
  const [saving, setSaving] = useState(false);
  // at least one photo is required — from the camera or from files
  const [photos, setPhotos] = useState<Array<{ file: File; url: string }>>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const addPhotos = (list: FileList | null) => {
    const imgs = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    if (list?.length && !imgs.length) toast.error("Please choose an image");
    setPhotos((p) => [...p, ...imgs.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10));
  };
  const removePhoto = (i: number) => setPhotos((p) => { URL.revokeObjectURL(p[i].url); return p.filter((_, j) => j !== i); });

  useEffect(() => {
    if (open) { setDate(todayIso()); setSelected([]); setRows({}); setNote(""); setFind(""); setPhotos([]); }
  }, [open]);

  const shown = people.filter((p) => !find.trim() || p.full_name.toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setRows((r) => (r[id] ? r : { ...r, [id]: { half: "", start: "", end: "" } }));
  };
  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => {
    const next = { ...(r[id] ?? { half: "", start: "", end: "" }), ...patch };
    return { ...r, [id]: next };
  });
  // copy the first person's times to everyone else
  const copyFirst = () => {
    const first = rows[selected[0]];
    if (!first) return;
    setRows((r) => Object.fromEntries(Object.entries({ ...r }).map(([k, v]) => [k, selected.includes(k) ? { ...first } : v])));
  };

  const totalMin = selected.reduce((s, id) => s + rowMin(rows[id]), 0);

  const save = async () => {
    if (!selected.length) return toast.error("Select at least one name");
    for (const id of selected) {
      const r = rows[id];
      const name = people.find((p) => p.id === id)?.full_name ?? "someone";
      if (!r?.half) return toast.error(`Choose Full day or Other time for ${name}`);
      if (r.half === "other") {
        if (!r.start || !r.end) return toast.error(`Enter the start and end time for ${name}`);
        if (spanMin(r.start, r.end) > 16 * 60) return toast.error(`Check the times for ${name} — more than 16 hours`);
      }
    }
    if (!photos.length) return toast.error("Attach at least one photo (take one or upload from files)");
    if (!userId) return toast.error("Please sign in again");
    setSaving(true);
    const uploaded: string[] = [];
    try {
      for (const ph of photos) {
        const blob = await shrinkPhoto(ph.file);
        const ext = blob.type === "image/jpeg" ? "jpg" : (ph.file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${userId}/${date}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg" });
        if (upErr) {
          if (/bucket/i.test(upErr.message)) throw new Error("Photo storage isn't set up yet — run TRILO_overtime_photos.sql");
          throw upErr;
        }
        uploaded.push(path);
      }
      const entries = selected.map((id) => ({
        employee_id: id, half: rows[id].half,
        start_time: rows[id].half === "other" ? rows[id].start : null,
        end_time: rows[id].half === "other" ? rows[id].end : null,
      }));
      const { error } = await (supabase as any).rpc("add_overtime_entries", { p_date: date, p_entries: entries, p_note: note.trim() || null, p_photos: uploaded });
      if (error) {
        if (/p_photos|schema cache|function/i.test(error.message ?? "")) throw new Error("Overtime photos aren't set up yet — run TRILO_overtime_photos.sql");
        throw error;
      }
      toast.success(`Overtime entered for ${selected.length} ${selected.length === 1 ? "person" : "people"} — ${isHari ? "sent to Anu" : "sent to Hari for approval"}`);
      onDone();
      onClose();
    } catch (e: any) {
      if (uploaded.length) supabase.storage.from(PHOTO_BUCKET).remove(uploaded).catch(() => {});
      toast.error("Could not save: " + (e?.message ?? ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add overtime</DialogTitle>
          <DialogDescription>Pick the OT members, then choose Full day or Other time for each person — for other time enter the start and end, the hours are worked out for you.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Date *</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-ink-muted">Names * {selected.length ? `(${selected.length} selected)` : ""}</label>
              {selected.length > 0 && (
                <button type="button" onClick={() => setSelected([])} className="text-xs text-primary hover:underline">Clear</button>
              )}
            </div>
            <div className="rounded-md border border-input">
              <div className="relative border-b border-border">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search people"
                  className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none" />
              </div>
              <div className="max-h-40 overflow-y-auto py-1">
                {shown.map((p) => {
                  const on = selected.includes(p.id);
                  return (
                    <button type="button" key={p.id} onClick={() => toggle(p.id)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${on ? "text-primary font-medium" : "text-ink-primary"}`}>
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "bg-primary border-primary text-primary-foreground" : "border-input"}`}>
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      {p.full_name}
                    </button>
                  );
                })}
                {!shown.length && <p className="px-3 py-2 text-sm text-ink-muted">{people.length ? "No one found" : "No OT members yet — an admin adds them under “OT members”."}</p>}
              </div>
            </div>
          </div>

          {selected.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-ink-muted">Time for each person *</label>
                {selected.length > 1 && rows[selected[0]]?.half && (rows[selected[0]].half === "full" || (rows[selected[0]].start && rows[selected[0]].end)) && (
                  <button type="button" onClick={copyFirst} className="text-xs text-primary hover:underline">Same time for everyone</button>
                )}
              </div>
              <div className="space-y-2">
                {selected.map((id) => {
                  const r = rows[id] ?? { half: "", start: "", end: "" };
                  const mins = rowMin(r);
                  return (
                    <div key={id} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink-primary truncate">{people.find((p) => p.id === id)?.full_name}</span>
                        <button type="button" onClick={() => toggle(id)} className="text-ink-muted hover:text-destructive" aria-label="Remove">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                        <div>
                          <label className="mb-1 block text-[11px] text-ink-muted">Overtime</label>
                          <select value={r.half} onChange={(e) => setRow(id, { half: e.target.value as Row["half"] })}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                            <option value="">Choose…</option>
                            <option value="full">Full day</option>
                            <option value="other">Other time</option>
                          </select>
                        </div>
                        <div className="flex h-9 items-center justify-center rounded-md bg-accent-light px-3 text-sm font-semibold text-primary min-w-[84px]">
                          {fmtSpan(mins)}
                        </div>
                      </div>
                      {r.half === "other" && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-ink-muted">Start</label>
                          <Input type="time" value={r.start} onChange={(e) => setRow(id, { start: e.target.value })} className="h-9" />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-ink-muted">End</label>
                          <Input type="time" value={r.end} onChange={(e) => setRow(id, { end: e.target.value })} className="h-9" />
                        </div>
                      </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-right text-sm text-ink-secondary">Total: <span className="font-semibold text-ink-primary">{fmtSpan(totalMin)}</span></p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Photo * {photos.length ? `(${photos.length})` : ""}</label>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            <input ref={filesRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => cameraRef.current?.click()} disabled={saving}>
                <Camera className="h-4 w-4" /> Take photo
              </Button>
              <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => filesRef.current?.click()} disabled={saving}>
                <ImagePlus className="h-4 w-4" /> Upload from files
              </Button>
            </div>
            {photos.length > 0 ? (
              <div className="mt-2 grid grid-cols-4 gap-2">
                {photos.map((ph, i) => (
                  <div key={ph.url} className="relative overflow-hidden rounded-lg border border-border">
                    <img src={ph.url} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
                    <button type="button" onClick={() => removePhoto(i)} disabled={saving}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white" aria-label="Remove photo">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-ink-muted">Required — take a photo or upload one from your files.</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Note (optional)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Work done / project" className="h-10" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !photos.length} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {saving ? "Sending…" : `${isHari ? "Send to Anu" : "Send to Hari for approval"}${selected.length ? ` (${selected.length})` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OvertimeMembersDialog({ open, onClose, people, memberIds, onChanged }: {
  open: boolean; onClose: () => void; people: Person[]; memberIds: string[]; onChanged: () => void;
}) {
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (open) setFind(""); }, [open]);

  const q = find.trim().toLowerCase();
  const current = people.filter((p) => memberIds.includes(p.id));
  const others = people.filter((p) => !memberIds.includes(p.id) && (!q || p.full_name.toLowerCase().includes(q)));

  const add = async (id: string) => {
    setBusy(id);
    const { error } = await (supabase as any).from("overtime_members").insert({ employee_id: id });
    setBusy(null);
    if (error) return toast.error("Could not add: " + error.message);
    onChanged();
  };
  const drop = async (id: string) => {
    setBusy(id);
    const { error } = await (supabase as any).from("overtime_members").delete().eq("employee_id", id);
    setBusy(null);
    if (error) return toast.error("Could not remove: " + error.message);
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>OT members</DialogTitle>
          <DialogDescription>People dedicated to overtime. Only they can be picked when adding overtime.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Current members ({current.length})</p>
            {current.length ? (
              <div className="flex flex-wrap gap-1.5">
                {current.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-accent-light px-2.5 py-1 text-xs font-medium text-primary">
                    {p.full_name}
                    <button type="button" disabled={busy === p.id} onClick={() => drop(p.id)} aria-label={`Remove ${p.full_name}`}>
                      {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No one yet — add people below.</p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Add people</p>
            <div className="rounded-md border border-input">
              <div className="relative border-b border-border">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search people"
                  className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none" />
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {others.map((p) => (
                  <button type="button" key={p.id} disabled={busy === p.id} onClick={() => add(p.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-ink-primary hover:bg-muted">
                    {p.full_name}
                    {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin text-ink-muted" /> : <Plus className="h-4 w-4 text-primary" />}
                  </button>
                ))}
                {!others.length && <p className="px-3 py-2 text-sm text-ink-muted">No one found</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ── Excel export (admins + Anu) ──────────────────────────────────────────────
function OvertimeExportDialog({ open, onClose, nameOf, approvedOnly }: {
  open: boolean; onClose: () => void; nameOf: (id?: string | null) => string; approvedOnly: boolean;
}) {
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [which, setWhich] = useState<"approved" | "all">("approved");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setFrom(monthStart); setTo(today); setWhich("approved"); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!from || !to || from > to) { toast.error("Choose a valid date range"); return; }
    setBusy(true);
    try {
      let q = (supabase as any).from("overtime_entries").select("*").gte("work_date", from).lte("work_date", to)
        .order("work_date").order("created_at").limit(10000);
      if (approvedOnly || which === "approved") q = q.not("verified_at", "is", null);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Entry[];
      if (!rows.length) { toast.error("No overtime in that period"); return; }

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const head = (ws: any, cols: string[]) => {
        const r = ws.addRow(cols); r.font = { bold: true };
        r.eachCell((c: any) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6E6E6" } }; });
      };
      const status = (e: Entry) => (e.verified_at ? "Approved" : e.rejected_at ? "Rejected" : "Waiting for approval");
      const t = (x?: string | null) => (x ? fmtTime(x) : "");
      const range = `${format(new Date(from + "T00:00:00"), "dd MMM yyyy")} – ${format(new Date(to + "T00:00:00"), "dd MMM yyyy")}`;

      // Summary per person (approved hours)
      const ws = wb.addWorksheet("Summary");
      ws.addRow([`Overtime — ${range}`]).font = { bold: true, size: 14 };
      ws.addRow([`Exported ${new Date().toLocaleString("en-IN")} · ${approvedOnly || which === "approved" ? "approved entries only" : "all entries"}`]);
      ws.addRow([]);
      head(ws, ["Employee", "Days", "Entries", "Approved hours", "Waiting hours", "Rejected hours"]);
      const byPerson = new Map<string, Entry[]>();
      rows.forEach((e) => byPerson.set(e.employee_id, [...(byPerson.get(e.employee_id) ?? []), e]));
      const sumH = (l: Entry[]) => l.reduce((s, e) => s + Number(e.duration_hours || 0), 0);
      const totals = [0, 0, 0, 0, 0];
      [...byPerson.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]))).forEach(([id, l]) => {
        const v = [new Set(l.map((e) => e.work_date)).size, l.length, sumH(l.filter((e) => e.verified_at)),
          sumH(l.filter((e) => !e.verified_at && !e.rejected_at)), sumH(l.filter((e) => e.rejected_at))];
        v.forEach((x, i) => { totals[i] += x; });
        ws.addRow([nameOf(id), ...v]);
      });
      ws.addRow(["TOTAL", ...totals]).font = { bold: true };
      [30, 8, 9, 16, 15, 15].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

      // Every entry
      const wl = wb.addWorksheet("Entries");
      head(wl, ["Date", "Employee", "Slot", "Start", "End", "Hours", "Status", "Approved by", "Approved on", "Rejected reason", "Entered by", "Note"]);
      rows.forEach((e) => {
        const r = wl.addRow([new Date(e.work_date + "T00:00:00"), nameOf(e.employee_id), halfLabel(e.half), t(e.start_time), t(e.end_time),
          Number(e.duration_hours || 0), status(e), e.verified_by ? nameOf(e.verified_by) : "", e.verified_at ? new Date(e.verified_at) : "",
          e.reject_reason ?? "", nameOf(e.created_by), e.note ?? ""]);
        r.getCell(1).numFmt = "dd-mmm-yyyy"; r.getCell(9).numFmt = "dd-mmm-yyyy hh:mm";
      });
      [13, 26, 14, 10, 10, 8, 20, 20, 18, 26, 20, 30].forEach((w, i) => { wl.getColumn(i + 1).width = w; });
      wl.autoFilter = { from: { row: 1, column: 1 }, to: { row: wl.rowCount, column: 12 } };
      wl.views = [{ state: "frozen", ySplit: 1 }];

      const buf = await wb.xlsx.writeBuffer();
      await saveFile(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Overtime ${from} to ${to}.xlsx`);
      onClose();
    } catch (e: any) {
      toast.error("Could not export: " + (e?.message ?? ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Download overtime (Excel)</DialogTitle>
          <DialogDescription>A summary per person and every entry for the dates you choose.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ot-from" className="mb-1.5 block text-sm font-medium text-ink-primary">From</label>
            <Input id="ot-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ot-to" className="mb-1.5 block text-sm font-medium text-ink-primary">To</label>
            <Input id="ot-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {!approvedOnly && (
          <div className="flex gap-2">
            {([["approved", "Approved only"], ["all", "All entries"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setWhich(k)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${which === k ? "border-primary bg-primary/10 text-primary" : "border-border text-ink-secondary"}`}>{l}</button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="gap-1.5" disabled={busy} onClick={run}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
