import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase, Brain, TrendingUp, Plus, X, Pencil, Trash2,
  Search, Save, ChevronDown, ChevronUp, Star, Target,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import UserAvatar from "@/components/UserAvatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type FocusArea = "business" | "competency" | "improvements";
type Quarter = 1 | 2 | 3 | 4;

type KraKpi = {
  id: string;
  user_id: string;
  cycle_year: number;
  focus_area: FocusArea;
  goal: string;
  kpi: string | null;
  weightage: number | null;
  q1_progress: string | null; q1_manager_feedback: string | null; q1_admin_feedback: string | null; q1_rating: number | null;
  q2_progress: string | null; q2_manager_feedback: string | null; q2_admin_feedback: string | null; q2_rating: number | null;
  q3_progress: string | null; q3_manager_feedback: string | null; q3_admin_feedback: string | null; q3_rating: number | null;
  q4_progress: string | null; q4_manager_feedback: string | null; q4_admin_feedback: string | null; q4_rating: number | null;
  final_rating: number | null;
  final_feedback: string | null;
  created_at: string;
};

const focusAreaConfig: Record<FocusArea, { label: string; tagline: string; icon: any; color: string; ring: string }> = {
  business:     { label: "Business",     tagline: "Outcomes that move the company", icon: Briefcase, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",         ring: "border-blue-200 dark:border-blue-900/40" },
  competency:   { label: "Competency",   tagline: "Skills, behaviors, expertise",   icon: Brain,     color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400", ring: "border-purple-200 dark:border-purple-900/40" },
  improvements: { label: "Improvements", tagline: "Process and quality wins",       icon: TrendingUp,color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", ring: "border-emerald-200 dark:border-emerald-900/40" },
};

const ratingColor = (r: number | null) => {
  if (r == null) return "bg-muted text-ink-muted";
  if (r === 1) return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (r === 2) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  if (r === 3) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
  if (r === 4) return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
};

const emptyForm = {
  focus_area: "business" as FocusArea,
  goal: "",
  kpi: "",
  weightage: "",
};

export default function KraKpiPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const canManage = isAdmin || isManager;

  const [searchParams, setSearchParams] = useSearchParams();
  const urlUserId = searchParams.get("user");

  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>(urlUserId ?? profile?.id ?? "");
  const [cycleYear, setCycleYear] = useState<number>(new Date().getFullYear());

  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<KraKpi | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Update URL when admin/manager changes selection
  useEffect(() => {
    if (canManage && selectedUserId && selectedUserId !== profile?.id) {
      setSearchParams({ user: selectedUserId }, { replace: true });
    }
  }, [selectedUserId, canManage, profile?.id, setSearchParams]);

  const targetUserId = canManage ? selectedUserId : profile?.id ?? "";

  const { data: people = [] } = useQuery({
    queryKey: ["kra-people", isManager ? `team:${profile?.id}` : "all"],
    queryFn: async () => {
      let q = supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, role")
        .order("full_name");
      // Manager only sees and rates their own team members.
      if (isManager && profile?.id) q = q.eq("manager_id", profile.id);
      const { data } = await q;
      return data ?? [];
    },
    enabled: canManage,
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["kra-kpi", targetUserId, cycleYear],
    queryFn: async () => {
      if (!targetUserId) return [] as KraKpi[];
      const { data, error } = await supabase
        .from("kra_kpi")
        .select("*")
        .eq("user_id", targetUserId)
        .eq("cycle_year", cycleYear)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as KraKpi[];
    },
    enabled: !!targetUserId,
  });

  const filteredPeople = useMemo(() => {
    const q = search.toLowerCase();
    return people.filter((p: any) =>
      !q || p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
    );
  }, [people, search]);

  const selectedPerson = useMemo(
    () => people.find((p: any) => p.id === targetUserId),
    [people, targetUserId]
  );

  const grouped: Record<FocusArea, KraKpi[]> = {
    business:     items.filter(i => i.focus_area === "business"),
    competency:   items.filter(i => i.focus_area === "competency"),
    improvements: items.filter(i => i.focus_area === "improvements"),
  };

  const overallScore = useMemo(() => {
    const rated = items.filter(i => i.final_rating != null);
    if (rated.length === 0) return null;
    const sum = rated.reduce((s, i) => s + (i.final_rating ?? 0), 0);
    return Math.round((sum / rated.length) * 10) / 10;
  }, [items]);

  // ---- mutations ----------------------------------------------------------
  const createMutation = useMutation({
    mutationFn: async (values: typeof emptyForm) => {
      const { error } = await supabase.from("kra_kpi").insert({
        user_id: targetUserId,
        cycle_year: cycleYear,
        focus_area: values.focus_area,
        goal: values.goal,
        kpi: values.kpi || null,
        weightage: values.weightage ? Number(values.weightage) : null,
        created_by: profile?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kra-kpi", targetUserId, cycleYear] });
      toast.success("Goal added");
      closeModal();
    },
    onError: (e: any) => toast.error("Failed: " + (e?.message ?? "")),
  });

  const updateGoalMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: typeof emptyForm }) => {
      const { error } = await supabase.from("kra_kpi").update({
        focus_area: values.focus_area,
        goal: values.goal,
        kpi: values.kpi || null,
        weightage: values.weightage ? Number(values.weightage) : null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kra-kpi", targetUserId, cycleYear] });
      toast.success("Updated");
      closeModal();
    },
    onError: (e: any) => toast.error("Failed: " + (e?.message ?? "")),
  });

  const updateRowMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<KraKpi> }) => {
      const { error } = await supabase.from("kra_kpi").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kra-kpi", targetUserId, cycleYear] });
    },
    onError: (e: any) => toast.error("Save failed: " + (e?.message ?? "")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kra_kpi").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kra-kpi", targetUserId, cycleYear] });
      toast.success("Deleted");
      setDeleteId(null);
    },
    onError: (e: any) => toast.error("Failed: " + (e?.message ?? "")),
  });

  const openAdd = (area: FocusArea) => {
    setEditItem(null);
    setForm({ ...emptyForm, focus_area: area });
    setModalOpen(true);
  };
  const openEdit = (i: KraKpi) => {
    setEditItem(i);
    setForm({
      focus_area: i.focus_area,
      goal: i.goal,
      kpi: i.kpi ?? "",
      weightage: i.weightage != null ? String(i.weightage) : "",
    });
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setEditItem(null); setForm(emptyForm); };
  const handleSubmit = () => {
    if (!form.goal.trim()) { toast.error("Goal is required"); return; }
    if (editItem) updateGoalMutation.mutate({ id: editItem.id, values: form });
    else createMutation.mutate(form);
  };

  const isOwnRow = (i: KraKpi) => i.user_id === profile?.id;

  // Year options: current + 2 prior
  const now = new Date().getFullYear();
  const years = [now + 1, now, now - 1, now - 2];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-ink-primary">KRA &amp; KPI</h2>
          <p className="text-sm text-ink-muted mt-0.5">
            {canManage
              ? "Assign goals & KPIs across the three focus areas. Verify quarterly progress and rate at year-end."
              : "Your goals and KPIs across business, competency and improvements. Update your quarterly progress."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={String(cycleYear)} onValueChange={(v) => setCycleYear(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          {overallScore != null && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", ratingColor(Math.round(overallScore)))}>
              <Star className="h-4 w-4" /> Avg {overallScore}
            </span>
          )}
        </div>
      </div>

      {/* Admin/manager person picker */}
      {canManage && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
              <Input
                placeholder="Search a person…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select a person" /></SelectTrigger>
              <SelectContent>
                {filteredPeople.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPerson && (
              <div className="flex items-center gap-2">
                <UserAvatar name={selectedPerson.full_name} avatarUrl={selectedPerson.avatar_url} size="sm" />
                <div>
                  <p className="text-sm font-medium text-ink-primary">{selectedPerson.full_name}</p>
                  <p className="text-xs text-ink-muted capitalize">{selectedPerson.role?.replace("_", " ")}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      {!targetUserId ? (
        <div className="rounded-xl border border-border bg-card flex flex-col items-center justify-center py-16 text-center">
          <Target className="h-10 w-10 text-ink-muted mb-3" />
          <h3 className="text-base font-semibold text-ink-primary">Select a person</h3>
          <p className="text-sm text-ink-muted">Pick someone above to view or assign their KRAs and KPIs.</p>
        </div>
      ) : isLoading ? (
        <div className="rounded-xl border border-border bg-card flex items-center justify-center py-16 text-ink-muted text-sm">
          Loading…
        </div>
      ) : (
        <div className="space-y-6">
          {(Object.keys(focusAreaConfig) as FocusArea[]).map((area) => (
            <FocusAreaSection
              key={area}
              area={area}
              items={grouped[area]}
              isAdmin={isAdmin}
              isManager={isManager}
              canManage={canManage}
              isOwnRow={isOwnRow}
              onAdd={() => openAdd(area)}
              onEdit={openEdit}
              onDelete={(id) => setDeleteId(id)}
              onPatch={(id, patch) => updateRowMutation.mutate({ id, patch })}
            />
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <AnimatePresence>
        {modalOpen && isAdmin && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={closeModal}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-ink-primary">
                    {editItem ? "Edit Goal" : "Add Goal"}
                  </h3>
                  <button onClick={closeModal} className="text-ink-muted hover:text-ink-primary">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Focus Area *</label>
                    <Select value={form.focus_area} onValueChange={(v) => setForm(f => ({ ...f, focus_area: v as FocusArea }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(focusAreaConfig) as FocusArea[]).map(a => (
                          <SelectItem key={a} value={a}>{focusAreaConfig[a].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Goal / Responsibility *</label>
                    <Input
                      placeholder="e.g. Deliver Q4 product launch"
                      value={form.goal}
                      onChange={(e) => setForm(f => ({ ...f, goal: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">KPI / Metric</label>
                    <textarea
                      className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 min-h-[70px]"
                      placeholder="e.g. Ship by Dec 15 with NPS ≥ 60"
                      value={form.kpi}
                      onChange={(e) => setForm(f => ({ ...f, kpi: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Weightage (%)</label>
                    <Input
                      type="number" min={0} max={100}
                      placeholder="e.g. 25"
                      value={form.weightage}
                      onChange={(e) => setForm(f => ({ ...f, weightage: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={closeModal}>Cancel</Button>
                  <Button
                    className="flex-1"
                    onClick={handleSubmit}
                    disabled={createMutation.isPending || updateGoalMutation.isPending}
                  >
                    {editItem ? "Save Changes" : "Add Goal"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteId && isAdmin && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={() => setDeleteId(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
                <h3 className="text-lg font-semibold text-ink-primary">Delete Goal?</h3>
                <p className="text-sm text-ink-muted">All quarterly progress and feedback for this goal will be removed.</p>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
                  <Button variant="destructive" className="flex-1" onClick={() => deleteMutation.mutate(deleteId!)} disabled={deleteMutation.isPending}>Delete</Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// =========================================================================
// Focus Area section
// =========================================================================
function FocusAreaSection({
  area, items, isAdmin, isManager, canManage, isOwnRow,
  onAdd, onEdit, onDelete, onPatch,
}: {
  area: FocusArea;
  items: KraKpi[];
  isAdmin: boolean;
  isManager: boolean;
  canManage: boolean;
  isOwnRow: (i: KraKpi) => boolean;
  onAdd: () => void;
  onEdit: (i: KraKpi) => void;
  onDelete: (id: string) => void;
  onPatch: (id: string, patch: Partial<KraKpi>) => void;
}) {
  const cfg = focusAreaConfig[area];
  const Icon = cfg.icon;

  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", cfg.ring)}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", cfg.color)}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink-primary">{cfg.label}</h3>
            <p className="text-[11px] text-ink-muted">{cfg.tagline} · {items.length} goal{items.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={onAdd}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Add Goal
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="px-5 py-10 text-sm text-ink-muted text-center">
          No goals in this focus area yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map(i => (
            <GoalRow
              key={i.id}
              item={i}
              isAdmin={isAdmin}
              isManager={isManager}
              canManage={canManage}
              own={isOwnRow(i)}
              onEdit={() => onEdit(i)}
              onDelete={() => onDelete(i.id)}
              onPatch={(patch) => onPatch(i.id, patch)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// =========================================================================
// Single goal row, with expandable quarterly tracker
// =========================================================================
function GoalRow({
  item, isAdmin, isManager, canManage, own, onEdit, onDelete, onPatch,
}: {
  item: KraKpi;
  isAdmin: boolean;
  isManager: boolean;
  canManage: boolean;
  own: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPatch: (patch: Partial<KraKpi>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeQ, setActiveQ] = useState<Quarter>(((new Date().getMonth() / 3) | 0) + 1 as Quarter);

  const ratingsArr = [item.q1_rating, item.q2_rating, item.q3_rating, item.q4_rating].filter(r => r != null) as number[];
  const ratingAvg = ratingsArr.length ? Math.round((ratingsArr.reduce((s, r) => s + r, 0) / ratingsArr.length) * 10) / 10 : null;

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex-1 text-left min-w-0 flex items-start gap-3"
        >
          <div className="mt-0.5 text-ink-muted shrink-0">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-ink-primary truncate">{item.goal}</p>
              {item.weightage != null && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-primary/10 text-primary shrink-0">
                  {item.weightage}%
                </span>
              )}
              {item.final_rating != null && (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0", ratingColor(item.final_rating))}>
                  <Star className="h-3 w-3" /> Final {item.final_rating}
                </span>
              )}
            </div>
            {item.kpi && (
              <p className="text-xs text-ink-muted mt-0.5"><span className="font-medium text-ink-secondary">KPI:</span> {item.kpi}</p>
            )}
            {/* Quarter status pills */}
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {[1, 2, 3, 4].map((q) => {
                const r = (item as any)[`q${q}_rating`] as number | null;
                const p = (item as any)[`q${q}_progress`] as string | null;
                return (
                  <span
                    key={q}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border",
                      r != null
                        ? cn(ratingColor(r), "border-transparent")
                        : p
                          ? "border-border bg-muted/40 text-ink-secondary"
                          : "border-dashed border-border text-ink-muted"
                    )}
                  >
                    Q{q}{r != null ? ` · ${r}` : p ? " · in progress" : ""}
                  </span>
                );
              })}
              {ratingAvg != null && (
                <span className="text-[11px] text-ink-muted">avg {ratingAvg}</span>
              )}
            </div>
          </div>
        </button>
        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-muted text-ink-muted hover:text-ink-primary" title="Edit goal">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-destructive/10 text-ink-muted hover:text-destructive" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
          {/* Quarter tabs */}
          <div className="flex items-center gap-1 mb-4 flex-wrap">
            {[1, 2, 3, 4].map((q) => (
              <button
                key={q}
                onClick={() => setActiveQ(q as Quarter)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium border transition",
                  activeQ === q
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-ink-secondary hover:bg-muted"
                )}
              >
                Q{q}
              </button>
            ))}
            <div className="flex-1" />
            {/* Final review (admin only, exposed in Q4) */}
            {isAdmin && activeQ === 4 && (
              <FinalRatingControl item={item} onPatch={onPatch} />
            )}
          </div>

          <QuarterEditor
            item={item}
            quarter={activeQ}
            isAdmin={isAdmin}
            isManager={isManager}
            canManage={canManage}
            own={own}
            onPatch={onPatch}
          />
        </div>
      )}
    </li>
  );
}

// =========================================================================
// Quarter editor — fields per role
// =========================================================================
function QuarterEditor({
  item, quarter, isAdmin, isManager, canManage, own, onPatch,
}: {
  item: KraKpi;
  quarter: Quarter;
  isAdmin: boolean;
  isManager: boolean;
  canManage: boolean;
  own: boolean;
  onPatch: (patch: Partial<KraKpi>) => void;
}) {
  const pKey = `q${quarter}_progress` as keyof KraKpi;
  const mKey = `q${quarter}_manager_feedback` as keyof KraKpi;
  const aKey = `q${quarter}_admin_feedback` as keyof KraKpi;
  const rKey = `q${quarter}_rating` as keyof KraKpi;

  // Local drafts so typing doesn't fire a request per keystroke
  const [progress, setProgress] = useState((item[pKey] as string | null) ?? "");
  const [managerFb, setManagerFb] = useState((item[mKey] as string | null) ?? "");
  const [adminFb, setAdminFb] = useState((item[aKey] as string | null) ?? "");
  const [rating, setRating] = useState<number | null>((item[rKey] as number | null) ?? null);

  // Re-sync if the quarter or item changes from outside
  useEffect(() => {
    setProgress((item[pKey] as string | null) ?? "");
    setManagerFb((item[mKey] as string | null) ?? "");
    setAdminFb((item[aKey] as string | null) ?? "");
    setRating((item[rKey] as number | null) ?? null);
  }, [item.id, quarter]); // eslint-disable-line react-hooks/exhaustive-deps

  const canEditProgress = own || isAdmin;
  const canEditManager = isManager || isAdmin;
  const canEditAdmin = isAdmin;
  const canEditRating = isManager || isAdmin;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Employee progress */}
      <div className="md:col-span-2">
        <label className="text-xs font-medium text-ink-muted mb-1.5 flex items-center justify-between">
          <span>Your progress (Q{quarter})</span>
          {canEditProgress && (
            <button
              onClick={() => onPatch({ [pKey]: progress } as Partial<KraKpi>)}
              className="text-[11px] text-primary hover:underline flex items-center gap-1"
            >
              <Save className="h-3 w-3" /> Save
            </button>
          )}
        </label>
        <textarea
          className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 min-h-[80px] disabled:opacity-60"
          placeholder={canEditProgress ? "What did you achieve this quarter?" : "—"}
          value={progress}
          onChange={(e) => setProgress(e.target.value)}
          disabled={!canEditProgress}
        />
      </div>

      {/* Manager feedback */}
      <div>
        <label className="text-xs font-medium text-ink-muted mb-1.5 flex items-center justify-between">
          <span>Manager feedback</span>
          {canEditManager && (
            <button
              onClick={() => onPatch({ [mKey]: managerFb } as Partial<KraKpi>)}
              className="text-[11px] text-primary hover:underline flex items-center gap-1"
            >
              <Save className="h-3 w-3" /> Save
            </button>
          )}
        </label>
        <textarea
          className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 min-h-[80px] disabled:opacity-60"
          placeholder={canEditManager ? "Verify and give feedback…" : "—"}
          value={managerFb}
          onChange={(e) => setManagerFb(e.target.value)}
          disabled={!canEditManager}
        />
      </div>

      {/* Admin feedback */}
      <div>
        <label className="text-xs font-medium text-ink-muted mb-1.5 flex items-center justify-between">
          <span>Admin feedback</span>
          {canEditAdmin && (
            <button
              onClick={() => onPatch({ [aKey]: adminFb } as Partial<KraKpi>)}
              className="text-[11px] text-primary hover:underline flex items-center gap-1"
            >
              <Save className="h-3 w-3" /> Save
            </button>
          )}
        </label>
        <textarea
          className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 min-h-[80px] disabled:opacity-60"
          placeholder={canEditAdmin ? "Final notes for the quarter…" : "—"}
          value={adminFb}
          onChange={(e) => setAdminFb(e.target.value)}
          disabled={!canEditAdmin}
        />
      </div>

      {/* Quarter rating */}
      {canManage && (
        <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink-primary">Quarter rating</p>
            <p className="text-xs text-ink-muted">1 = highest · 5 = lowest</p>
          </div>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                disabled={!canEditRating}
                onClick={() => {
                  const next = rating === r ? null : r;
                  setRating(next);
                  onPatch({ [rKey]: next } as Partial<KraKpi>);
                }}
                className={cn(
                  "w-9 h-9 rounded-md border text-sm font-semibold transition",
                  rating === r
                    ? cn(ratingColor(r), "border-transparent")
                    : "border-border bg-card text-ink-secondary hover:bg-muted",
                  !canEditRating && "opacity-60 cursor-not-allowed"
                )}
              >
                {r}
              </button>
            ))}
            {rating != null && canEditRating && (
              <button
                onClick={() => { setRating(null); onPatch({ [rKey]: null } as Partial<KraKpi>); }}
                className="ml-1 text-xs text-ink-muted hover:text-ink-primary"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Final-review rating control (Q4 only, admin only)
// =========================================================================
function FinalRatingControl({
  item, onPatch,
}: { item: KraKpi; onPatch: (patch: Partial<KraKpi>) => void; }) {
  const [rating, setRating] = useState<number | null>(item.final_rating);
  const [feedback, setFeedback] = useState(item.final_feedback ?? "");
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    setRating(item.final_rating);
    setFeedback(item.final_feedback ?? "");
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-ink-muted">Final rating</span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((r) => (
          <button
            key={r}
            onClick={() => {
              const next = rating === r ? null : r;
              setRating(next);
              onPatch({ final_rating: next });
            }}
            className={cn(
              "w-7 h-7 rounded-md border text-xs font-semibold transition",
              rating === r ? cn(ratingColor(r), "border-transparent") : "border-border bg-card text-ink-secondary hover:bg-muted"
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <button
        onClick={() => setShowFeedback(s => !s)}
        className="text-xs text-primary hover:underline ml-1"
      >
        {showFeedback ? "Hide notes" : "Notes"}
      </button>
      {showFeedback && (
        <div className="absolute right-5 mt-2 z-10 bg-card border border-border rounded-lg shadow-md p-3 w-72">
          <textarea
            className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 min-h-[80px]"
            placeholder="Final review notes…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={() => { onPatch({ final_feedback: feedback }); setShowFeedback(false); }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
