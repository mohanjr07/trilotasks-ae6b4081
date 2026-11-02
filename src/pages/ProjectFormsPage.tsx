// ─────────────────────────────────────────────────────────────────────────────
//  Projects → Forms.
//  /project-forms        every project with how many forms it has
//  /project-forms/:id    the project's forms timeline:
//     Order Booking → Pre Design → Design → Post Design → Production → Dispatch
//  Click a stage → its form types branch out; click a form type → every filled
//  form of that type for this project branches out (click one to open it).
//  Admins add / remove form types in a stage; anyone can fill a new one here.
// ─────────────────────────────────────────────────────────────────────────────
import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, FileStack, Plus, Search, X, FileText, CheckCircle2, Clock, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import FormRequestDialog, { type RequestableForm } from "@/components/FormRequestDialog";
import { STATUS_LABEL } from "@/lib/formSchemas";
import { useFormPeople } from "@/lib/useFormPeople";

const sb = supabase as any;

export const FORM_STAGES = [
  { key: "order_booking", label: "Order Booking" },
  { key: "pre_design", label: "Pre Design" },
  { key: "design", label: "Design" },
  { key: "post_design", label: "Post Design" },
  { key: "production", label: "Production" },
  { key: "dispatch", label: "Dispatch" },
] as const;
type StageKey = (typeof FORM_STAGES)[number]["key"];

type Project = { id: string; name: string; color?: string | null };
type Template = RequestableForm & { title: string };
type StageMap = { form_id: string; stage: StageKey; sort_order: number };
type Req = {
  id: string; form_id: string; form_title: string; reference_value: string | null; revision: number | null;
  status: "pending_approval" | "pending_authorization" | "authorized" | "rejected";
  requested_by: string; submitted_at: string; project_id: string | null;
};

function useProjects() {
  return useQuery({
    queryKey: ["form-projects-full"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rpc = await sb.rpc("pp_projects");
      if (!rpc.error) return (rpc.data ?? []) as Project[];
      const { data, error } = await supabase.from("projects").select("id, name, color").order("name");
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });
}

const STATUS_STYLE: Record<Req["status"], { cls: string; icon: typeof Clock }> = {
  pending_approval: { cls: "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200", icon: Clock },
  pending_authorization: { cls: "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200", icon: Clock },
  authorized: { cls: "border-green-500 bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200", icon: CheckCircle2 },
  rejected: { cls: "border-red-400 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200", icon: XCircle },
};

// ── list of projects ─────────────────────────────────────────────────────────
export default function ProjectFormsPage() {
  const { id } = useParams();
  return id ? <ProjectFormsTree projectId={id} /> : <ProjectFormsList />;
}

function ProjectFormsList() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useProjects();
  const [q, setQ] = useState("");
  const { data: counts = new Map<string, { total: number; waiting: number }>() } = useQuery({
    queryKey: ["form-requests", "project-counts"],
    queryFn: async () => {
      const { data, error } = await sb.from("form_requests").select("project_id, status").limit(5000);
      if (error) throw error;
      const m = new Map<string, { total: number; waiting: number }>();
      for (const r of (data ?? []) as Array<{ project_id: string | null; status: string }>) {
        if (!r.project_id) continue;
        const c = m.get(r.project_id) ?? { total: 0, waiting: 0 };
        c.total++; if (r.status === "pending_approval" || r.status === "pending_authorization") c.waiting++;
        m.set(r.project_id, c);
      }
      return m;
    },
  });
  const shown = projects.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (counts.get(b.id)?.total ?? 0) - (counts.get(a.id)?.total ?? 0) || a.name.localeCompare(b.name));

  return (
    <AnimatedPage>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary"><ArrowLeft className="h-4 w-4" /> Projects</Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-xl sm:text-[28px] font-bold text-ink-primary">Project forms</h1>
          <p className="text-sm text-ink-muted mt-0.5">Open a project to see its forms from Order Booking to Dispatch.</p>
        </div>
        <div className="relative sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project"
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" />
        </div>
      </div>
      {isLoading ? <div className="h-40 rounded-xl bg-muted animate-pulse" /> : !shown.length ? (
        <EmptyState icon={FileStack} title="No projects" description="Projects will show here." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => {
            const c = counts.get(p.id);
            return (
              <button key={p.id} onClick={() => navigate(`/project-forms/${p.id}`)}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm hover:border-primary/50">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color ?? "#3b82f6" }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading text-sm font-bold text-ink-primary">{p.name}</p>
                  <p className="text-xs text-ink-muted">
                    {c?.total ? `${c.total} form${c.total === 1 ? "" : "s"}` : "No forms yet"}
                    {c?.waiting ? ` · ${c.waiting} waiting` : ""}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-ink-muted" />
              </button>
            );
          })}
        </div>
      )}
    </AnimatedPage>
  );
}

// ── one project's timeline ───────────────────────────────────────────────────
function Branch({ children }: { children: React.ReactNode }) {
  // a line down from the parent, then a bar over the children
  return (
    <div className="flex flex-col items-center">
      <div className="h-6 w-px bg-ink-muted/60" />
      <div className="relative flex flex-wrap justify-center gap-x-4 gap-y-6 border-t border-ink-muted/60 px-2 pt-5">
        {children}
      </div>
    </div>
  );
}
function Leaf({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex flex-col items-center">
      <div className="absolute -top-5 left-1/2 h-5 w-px bg-ink-muted/60" />
      {children}
    </div>
  );
}

function ProjectFormsTree({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { names } = useFormPeople();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.id === projectId);
  const [stage, setStage] = useState<StageKey | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [fill, setFill] = useState<Template | null>(null);
  const [adding, setAdding] = useState<StageKey | null>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ["production-forms", "list"],
    queryFn: async () => {
      const { data, error } = await sb.from("production_forms").select("id, title, ref_number_enabled, ref_prefix, ref_padding, current_number").order("title");
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });
  const { data: map = [], error: mapError } = useQuery({
    queryKey: ["form-stage-map"],
    queryFn: async () => {
      const { data, error } = await sb.from("form_stage_map").select("form_id, stage, sort_order");
      if (error) throw error;
      return (data ?? []) as StageMap[];
    },
  });
  const { data: reqs = [] } = useQuery({
    queryKey: ["form-requests", "project", projectId],
    queryFn: async () => {
      const { data, error } = await sb.from("form_requests")
        .select("id, form_id, form_title, reference_value, revision, status, requested_by, submitted_at, project_id")
        .eq("project_id", projectId).order("submitted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Req[];
    },
  });

  const formsOf = (s: StageKey) => map.filter((m) => m.stage === s)
    .map((m) => ({ m, t: templates.find((t) => t.id === m.form_id) }))
    .filter((x): x is { m: StageMap; t: Template } => !!x.t)
    .sort((a, b) => a.m.sort_order - b.m.sort_order || a.t.title.localeCompare(b.t.title));
  const reqsOfForm = (fid: string) => reqs.filter((r) => r.form_id === fid);
  const reqsOfStage = (s: StageKey) => formsOf(s).flatMap((x) => reqsOfForm(x.t.id));
  const stageTone = (s: StageKey) => {
    const r = reqsOfStage(s);
    if (!r.length) return "idle";
    if (r.some((x) => x.status === "pending_approval" || x.status === "pending_authorization")) return "waiting";
    if (r.some((x) => x.status === "rejected") && !r.some((x) => x.status === "authorized")) return "rejected";
    return "done";
  };
  const unmapped = templates.filter((t) => !map.some((m) => m.form_id === t.id));
  const otherForms = reqs.filter((r) => !map.some((m) => m.form_id === r.form_id));

  const addMap = useMutation({
    mutationFn: async (a: { form_id: string; stage: StageKey }) => {
      const { error } = await sb.from("form_stage_map").insert({ form_id: a.form_id, stage: a.stage, sort_order: formsOf(a.stage).length });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["form-stage-map"] }); setAdding(null); toast.success("Form added to the stage"); },
    onError: (e: any) => toast.error(/form_stage_map/.test(e?.message ?? "") ? "Run the project forms SQL first" : e?.message ?? "Could not add"),
  });
  const removeMap = useMutation({
    mutationFn: async (fid: string) => {
      const { error } = await sb.from("form_stage_map").delete().eq("form_id", fid);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["form-stage-map"] }); setFormId(null); toast.success("Removed from the stage"); },
    onError: (e: any) => toast.error(e?.message ?? "Could not remove"),
  });

  const selForm = formId ? templates.find((t) => t.id === formId) : null;

  return (
    <AnimatedPage>
      <Link to="/project-forms" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary"><ArrowLeft className="h-4 w-4" /> All projects</Link>
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-wide text-ink-muted">Project forms</p>
        <h1 className="font-heading text-xl sm:text-[26px] font-bold text-ink-primary">{project?.name ?? "Project"}</h1>
        <p className="text-sm text-ink-muted mt-0.5">{reqs.length} form{reqs.length === 1 ? "" : "s"} · click a stage to see its forms</p>
      </div>

      {mapError && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">Run the project forms SQL in Supabase to set up the stages.</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="mx-auto w-max min-w-full">
          {/* stages */}
          <div className="flex items-center justify-center">
            {FORM_STAGES.map((s, i) => {
              const tone = stageTone(s.key);
              const n = reqsOfStage(s.key).length;
              const sel = stage === s.key;
              return (
                <Fragment key={s.key}>
                  <button onClick={() => { setStage(sel ? null : s.key); setFormId(null); }}
                    className={cn("flex min-w-[112px] flex-col items-center rounded-2xl border-2 px-3 py-2.5 text-center transition-colors",
                      sel ? "border-primary bg-primary text-primary-foreground shadow-md"
                        : tone === "done" ? "border-green-500 bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-100"
                        : tone === "waiting" ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
                        : tone === "rejected" ? "border-red-400 bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-100"
                        : "border-border bg-background text-ink-primary hover:border-primary/50")}>
                    <span className="text-sm font-semibold whitespace-nowrap">{s.label}</span>
                    <span className={cn("text-[11px]", sel ? "text-primary-foreground/80" : "text-ink-muted")}>{n ? `${n} form${n === 1 ? "" : "s"}` : formsOf(s.key).length ? "not started" : "—"}</span>
                  </button>
                  {i < FORM_STAGES.length - 1 && (
                    <div className="flex items-center px-1" aria-hidden>
                      <div className="h-[1.5px] w-5 sm:w-8 bg-ink-primary/70" />
                      <div className="h-0 w-0 border-y-[5px] border-y-transparent border-l-[8px] border-l-ink-primary/70" />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>

          {/* level 1: form types of the stage */}
          {stage && (
            <div className="flex justify-center">
              <Branch>
                {formsOf(stage).map(({ t }) => {
                  const n = reqsOfForm(t.id).length;
                  const sel = formId === t.id;
                  return (
                    <Leaf key={t.id}>
                      <div className="relative">
                        <button onClick={() => setFormId(sel ? null : t.id)}
                          className={cn("flex min-w-[150px] max-w-[220px] flex-col items-center rounded-full border-2 px-4 py-2 text-center",
                            sel ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-ink-primary hover:border-primary/50")}>
                          <span className="text-sm font-medium leading-tight">{t.title}</span>
                          <span className="text-[11px] text-ink-muted">{n} filled</span>
                        </button>
                        {isAdmin && (
                          <button title="Remove from this stage" aria-label="Remove from this stage"
                            onClick={() => { if (window.confirm(`Remove "${t.title}" from ${FORM_STAGES.find((s) => s.key === stage)?.label}? Filled forms are not deleted.`)) removeMap.mutate(t.id); }}
                            className="absolute -right-1 -top-1 rounded-full border border-border bg-card p-0.5 text-ink-muted hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </Leaf>
                  );
                })}
                {isAdmin && (
                  <Leaf>
                    <button onClick={() => setAdding(stage)}
                      className="flex min-w-[120px] items-center justify-center gap-1.5 rounded-full border-2 border-dashed border-border px-4 py-2.5 text-sm text-ink-secondary hover:border-primary hover:text-primary">
                      <Plus className="h-4 w-4" /> Add form
                    </button>
                  </Leaf>
                )}
                {!formsOf(stage).length && !isAdmin && (
                  <Leaf><p className="px-4 py-2 text-sm text-ink-muted">No forms in this stage yet</p></Leaf>
                )}
              </Branch>
            </div>
          )}

          {/* level 2: the filled forms */}
          {stage && selForm && (
            <div className="flex justify-center">
              <Branch>
                {reqsOfForm(selForm.id).map((r) => {
                  const st = STATUS_STYLE[r.status];
                  return (
                    <Leaf key={r.id}>
                      <button onClick={() => navigate(`/form-requests?id=${r.id}`)}
                        className={cn("flex w-[170px] flex-col items-center rounded-xl border-2 px-3 py-2 text-center hover:shadow-md", st.cls)}>
                        <span className="flex items-center gap-1 text-sm font-semibold"><FileText className="h-3.5 w-3.5" /> {r.reference_value ?? "Form"}{r.revision ? ` · Rev ${String(r.revision).padStart(2, "0")}` : ""}</span>
                        <span className="flex items-center gap-1 text-[11px]"><st.icon className="h-3 w-3" /> {STATUS_LABEL[r.status]}</span>
                        <span className="text-[11px] opacity-80">{names[r.requested_by] ?? "—"} · {format(new Date(r.submitted_at), "d MMM yyyy")}</span>
                      </button>
                    </Leaf>
                  );
                })}
                <Leaf>
                  <button onClick={() => setFill(selForm)}
                    className="flex w-[170px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-primary/50 px-3 py-3 text-sm font-medium text-primary hover:bg-primary/5">
                    <Plus className="h-4 w-4" /> Fill new {selForm.title}
                  </button>
                </Leaf>
              </Branch>
            </div>
          )}
        </div>
      </div>

      {otherForms.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Other forms for this project</p>
          <div className="flex flex-wrap gap-2">
            {otherForms.map((r) => (
              <button key={r.id} onClick={() => navigate(`/form-requests?id=${r.id}`)}
                className={cn("rounded-lg border px-3 py-1.5 text-xs", STATUS_STYLE[r.status].cls)}>
                {r.form_title}{r.reference_value ? ` · ${r.reference_value}` : ""} — {STATUS_LABEL[r.status]}
              </button>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!adding} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a form to {FORM_STAGES.find((s) => s.key === adding)?.label}</DialogTitle>
            <DialogDescription>Forms from Forms and Formats. The stage applies to every project.</DialogDescription>
          </DialogHeader>
          {unmapped.length ? (
            <div className="max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {unmapped.map((t) => (
                <button key={t.id} disabled={addMap.isPending} onClick={() => adding && addMap.mutate({ form_id: t.id, stage: adding })}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted">
                  <FileStack className="h-4 w-4 text-ink-muted" /> {t.title}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Every form is already in a stage. Upload a new form in Forms and Formats, or remove one from another stage first.</p>
          )}
          <div className="flex justify-end pt-2"><Button variant="outline" onClick={() => setAdding(null)}>Close</Button></div>
        </DialogContent>
      </Dialog>

      <FormRequestDialog open={!!fill} onClose={() => setFill(null)} form={fill} presetProjectId={projectId}
        onSubmitted={() => qc.invalidateQueries({ queryKey: ["form-requests"] })} />
    </AnimatedPage>
  );
}
