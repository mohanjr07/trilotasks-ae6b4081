// ─────────────────────────────────────────────────────────────────────────────
//  Overtime — admins add entries (pick many people at once), managers/admins
//  verify them, and anu@triloautomation.com is notified of verified entries.
//  Only admins, managers and Anu can open this page.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Timer, Plus, ShieldCheck, Trash2, Search, Check, X, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

export const OVERTIME_VIEWER_EMAILS = ["anu@triloautomation.com"];

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
  half: "first" | "second";
  duration_hours: number;
  note: string | null;
  created_by: string;
  created_at: string;
  verified_by: string | null;
  verified_at: string | null;
};
type Person = { id: string; full_name: string; role: string };

const halfLabel = (h: string) => (h === "first" ? "First half" : "Second half");
const hours = (n: number) => `${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })} h`;
const todayIso = () => format(new Date(), "yyyy-MM-dd");

export default function OvertimePage() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const allowed = canSeeOvertime(profile as any);
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const canVerify = isAdmin || profile?.role === "manager";

  const [tab, setTab] = useState<"pending" | "verified" | "all">("pending");
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
      toast.success(`${n} ${n === 1 ? "entry" : "entries"} verified — Anu has been notified`);
    },
    onError: (e: any) => toast.error("Could not verify: " + (e?.message ?? "")),
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
  const list = entries.filter((e) =>
    (tab === "all" || (tab === "pending" ? !e.verified_at : !!e.verified_at)) &&
    (!q || nameOf(e.employee_id).toLowerCase().includes(q)));

  const byDate = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of list) m.set(e.work_date, [...(m.get(e.work_date) ?? []), e]);
    return Array.from(m.entries());
  }, [list]);

  const pendingCount = entries.filter((e) => !e.verified_at).length;
  const pendingPicked = Array.from(picked).filter((id) => entries.find((e) => e.id === id && !e.verified_at));
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
            {isAdmin ? "Add overtime, then a manager verifies it — Anu is notified of every verified entry."
              : canVerify ? "Check the overtime entries and mark them verified — Anu is notified."
              : "Verified overtime entries from the managers."}
          </p>
        </div>
        <div className="flex gap-2">
          {canVerify && pendingPicked.length > 0 && (
            <Button variant="outline" className="gap-1.5" disabled={verify.isPending} onClick={() => verify.mutate(pendingPicked)}>
              <ShieldCheck className="h-4 w-4" /> Verify selected ({pendingPicked.length})
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" className="gap-1.5" onClick={() => setMembersOpen(true)}>
              <Users className="h-4 w-4" /> OT members ({members.length})
            </Button>
          )}
          {isAdmin && (
            <Button className="gap-1.5" onClick={() => (members.length ? setAddOpen(true) : setMembersOpen(true))}>
              <Plus className="h-4 w-4" /> Add overtime
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 border-b border-border">
          {([["pending", `Waiting for verification${pendingCount ? ` (${pendingCount})` : ""}`], ["verified", "Verified"], ["all", "All"]] as const).map(([k, label]) => (
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
          title={tab === "pending" ? "Nothing waiting for verification" : "No overtime entries"}
          description={isAdmin
            ? (members.length ? "Click “Add overtime” to enter overtime for one or more people." : "First add the people dedicated to overtime under “OT members”, then add their overtime.")
            : "New entries will appear here."} />
      ) : (
        <div className="space-y-5">
          {byDate.map(([date, rows]) => {
            const dayPending = rows.filter((r) => !r.verified_at).map((r) => r.id);
            const total = rows.reduce((s, r) => s + Number(r.duration_hours), 0);
            return (
              <div key={date} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <p className="text-sm font-semibold text-ink-primary">
                    {format(new Date(date + "T00:00:00"), "EEE, d MMM yyyy")}
                    <span className="ml-2 font-normal text-ink-muted">{rows.length} {rows.length === 1 ? "person" : "people"} · {hours(total)}</span>
                  </p>
                  {canVerify && dayPending.length > 0 && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={verify.isPending} onClick={() => verify.mutate(dayPending)}>
                      <ShieldCheck className="h-4 w-4" /> Verify all ({dayPending.length})
                    </Button>
                  )}
                </div>
                <div className="divide-y divide-border">
                  {rows.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      {canVerify && !r.verified_at && (
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} aria-label="Select" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-primary truncate">{nameOf(r.employee_id)}</p>
                        <p className="text-xs text-ink-muted">
                          Added by {nameOf(r.created_by)}{r.note ? ` · ${r.note}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-ink-secondary">{halfLabel(r.half)}</span>
                      <span className="w-16 text-right font-heading text-sm font-bold text-ink-primary">{hours(r.duration_hours)}</span>
                      {r.verified_at ? (
                        <span className="text-xs text-success text-right min-w-[150px]">
                          ✓ Verified by {nameOf(r.verified_by)}
                          <span className="block text-ink-muted">{format(new Date(r.verified_at), "d MMM, h:mm a")}</span>
                        </span>
                      ) : canVerify ? (
                        <Button size="sm" className="h-8 gap-1.5 min-w-[110px]" disabled={verify.isPending} onClick={() => verify.mutate([r.id])}>
                          <ShieldCheck className="h-4 w-4" /> Verified
                        </Button>
                      ) : (
                        <span className="text-xs text-warning min-w-[110px] text-right">Waiting for verification</span>
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

      {isAdmin && (
        <AddOvertimeDialog open={addOpen} onClose={() => setAddOpen(false)} people={members} userId={user?.id ?? ""}
          onDone={() => qc.invalidateQueries({ queryKey: ["overtime"] })} />
      )}
      {isAdmin && (
        <OvertimeMembersDialog open={membersOpen} onClose={() => setMembersOpen(false)} people={people} memberIds={memberIds}
          onChanged={() => qc.invalidateQueries({ queryKey: ["ot-members"] })} />
      )}
    </AnimatedPage>
  );
}

function AddOvertimeDialog({ open, onClose, people, userId, onDone }: {
  open: boolean; onClose: () => void; people: Person[]; userId: string; onDone: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [selected, setSelected] = useState<string[]>([]);
  const [half, setHalf] = useState<"first" | "second" | "">("");
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");
  const [find, setFind] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setDate(todayIso()); setSelected([]); setHalf(""); setDuration(""); setNote(""); setFind(""); }
  }, [open]);

  const shown = people.filter((p) => !find.trim() || p.full_name.toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const save = async () => {
    if (!selected.length) return toast.error("Select at least one name");
    if (!half) return toast.error("Choose First half or Second half");
    const h = Number(duration);
    if (!h || h <= 0 || h > 24) return toast.error("Enter the OT duration in hours");
    setSaving(true);
    try {
      const rows = selected.map((employee_id) => ({
        work_date: date, employee_id, half, duration_hours: h, note: note.trim() || null, created_by: userId,
      }));
      const { error } = await (supabase as any).from("overtime_entries").insert(rows);
      if (error) throw error;
      toast.success(`Overtime added for ${selected.length} ${selected.length === 1 ? "person" : "people"} — waiting for verification`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error("Could not save: " + (e?.message ?? ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add overtime</DialogTitle>
          <DialogDescription>Pick one or more OT members — each gets the same half and duration.</DialogDescription>
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
            {selected.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selected.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-accent-light px-2.5 py-1 text-xs font-medium text-primary">
                    {people.find((p) => p.id === id)?.full_name}
                    <button type="button" onClick={() => toggle(id)} aria-label="Remove"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="rounded-md border border-input">
              <div className="relative border-b border-border">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search people"
                  className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none" />
              </div>
              <div className="max-h-48 overflow-y-auto py-1">
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
                {!shown.length && <p className="px-3 py-2 text-sm text-ink-muted">{people.length ? "No one found" : "No OT members yet — add them under “OT members”."}</p>}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Half *</label>
            <div className="grid grid-cols-2 gap-2">
              {(["first", "second"] as const).map((h) => (
                <button type="button" key={h} onClick={() => setHalf(h)}
                  className={`h-10 rounded-md border text-sm font-medium transition-colors ${half === h ? "border-primary bg-accent-light text-primary" : "border-input text-ink-secondary hover:bg-muted"}`}>
                  {halfLabel(h)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">OT Duration (hours) *</label>
            <Input type="number" inputMode="decimal" min="0.5" max="24" step="0.5" value={duration}
              onChange={(e) => setDuration(e.target.value)} placeholder="e.g. 2 or 2.5" className="h-10" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Note (optional)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Work done / project" className="h-10" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {saving ? "Saving…" : `Add${selected.length ? ` for ${selected.length}` : ""}`}
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
