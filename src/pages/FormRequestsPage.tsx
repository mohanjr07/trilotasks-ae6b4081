// Form approvals: requesters track their forms; Hari (Anu for asset/expense) approves; Saravanan /
// Jaisoorya authorize. Opens straight to a request from a notification
// (/form-requests?id=…).
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, X, Download, Pencil, FileStack, ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import MobileSegments from "@/components/MobileSegments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { FormRequestRow } from "@/components/FormDocument";
import FilledFormPreview, { type FilledFormHandle } from "@/components/FilledFormPreview";
import { saveFile } from "@/lib/nativeFiles";
import FormRequestDialog from "@/components/FormRequestDialog";
import { FormAttachmentsList } from "@/components/FormAttachments";
import { schemaForTitle, STATUS_LABEL, APPROVER_EMAIL, AUTHORIZER_NAMES } from "@/lib/formSchemas";

const REVIEWER_EMAILS = [APPROVER_EMAIL, "anu@triloautomation.com", "harishkanna@triloautomation.com"];
import { useFormPeople } from "@/lib/useFormPeople";

type TabKey = "waiting" | "mine" | "handled" | "all";
type StatusFilter = "any" | "progress" | "authorized" | "rejected";

const statusClass: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  pending_authorization: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  authorized: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

export default function FormRequestsPage() {
  const { user, profile, isAdmin } = useAuth();
  const qc = useQueryClient();
  const { names } = useFormPeople();
  const [params, setParams] = useSearchParams();
  const openId = params.get("id");
  const urlTab = params.get("tab") as TabKey | null;
  const [tab, setTabState] = useState<TabKey | null>(urlTab);
  const setTab = (k: TabKey) => { setTabState(k); params.set("tab", k); setParams(params, { replace: true }); };
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("any");
  const [search, setSearch] = useState("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["form-requests"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("form_requests").select("*").order("submitted_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as FormRequestRow[];
    },
    enabled: !!user,
  });

  // Live updates when someone approves / rejects
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("form-requests-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "form_requests" }, () =>
        qc.invalidateQueries({ queryKey: ["form-requests"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, qc]);

  const myTurn = (r: FormRequestRow) =>
    (r.status === "pending_approval" && r.approver_id === user?.id) ||
    (r.status === "pending_authorization" && r.authorizer_id === user?.id);

  const waiting = requests.filter(myTurn);
  // every form this person has filled — kept here forever, whatever its status
  const mine = requests.filter((r) => r.requested_by === user?.id);
  // forms this person approved / authorized / rejected (stay visible after they act)
  const handled = requests.filter((r) =>
    (r.approver_id === user?.id && (r.approved_at || (r.status === "rejected" && r.rejected_by === user?.id))) ||
    (r.authorizer_id === user?.id && (r.authorized_at || (r.status === "rejected" && r.rejected_by === user?.id))));
  const isApproverAnywhere = requests.some((r) => r.approver_id === user?.id || r.authorizer_id === user?.id);
  // only approvers / authorizers get the "Waiting for me" tab — regular employees just see their own forms
  const email = (user?.email ?? "").toLowerCase();
  const firstName = ((profile as any)?.full_name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const isReviewer = isApproverAnywhere || REVIEWER_EMAILS.includes(email) ||
    AUTHORIZER_NAMES.some((n) => n.toLowerCase() === firstName);
  const allowed: TabKey[] = [
    ...(isReviewer ? ["waiting" as const] : []), "mine",
    ...(isApproverAnywhere ? ["handled" as const] : []),
    ...(isAdmin || isApproverAnywhere ? ["all" as const] : []),
  ];
  const fallback: TabKey = isReviewer && waiting.length ? "waiting" : "mine";
  const activeTab: TabKey = tab && allowed.includes(tab) ? tab : fallback;
  const base = activeTab === "waiting" ? waiting : activeTab === "mine" ? mine : activeTab === "handled" ? handled : requests;
  const q = search.trim().toLowerCase();
  const list = base.filter((r) => {
    if (activeTab !== "waiting") {
      if (statusFilter === "progress" && !(r.status === "pending_approval" || r.status === "pending_authorization")) return false;
      if (statusFilter === "authorized" && r.status !== "authorized") return false;
      if (statusFilter === "rejected" && r.status !== "rejected") return false;
    }
    if (!q) return true;
    return [r.form_title, r.reference_value, names[r.requested_by]].some((v) => (v ?? "").toLowerCase().includes(q));
  });

  const tabs = [
    ...(isReviewer ? [{ key: "waiting" as const, label: `Waiting for me${waiting.length ? ` (${waiting.length})` : ""}` }] : []),
    { key: "mine" as const, label: `My forms${mine.length ? ` (${mine.length})` : ""}` },
    ...(isApproverAnywhere ? [{ key: "handled" as const, label: "Approved by me" }] : []),
    ...(isAdmin || isApproverAnywhere ? [{ key: "all" as const, label: "All" }] : []),
  ];
  const filters: { key: StatusFilter; label: string }[] = [
    { key: "any", label: "All" },
    { key: "progress", label: "In progress" },
    { key: "authorized", label: "Authorized" },
    { key: "rejected", label: "Rejected" },
  ];

  const selected = useMemo(() => requests.find((r) => r.id === openId) ?? null, [requests, openId]);
  const close = () => { params.delete("id"); setParams(params, { replace: true }); };
  const open = (id: string) => { params.set("id", id); setParams(params); };

  return (
    <AnimatedPage>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl sm:text-[28px] font-bold text-ink-primary">{isReviewer || isAdmin ? "Form Approvals" : "My Forms"}</h1>
          <p className="text-sm text-ink-muted">Every form you fill stays under “My forms” — before and after it is authorized.</p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to="/production-forms"><FileStack className="h-4 w-4" /> New request</Link>
        </Button>
      </div>

      <MobileSegments className="w-full mb-4" items={tabs} value={activeTab} onChange={(k) => setTab(k as TabKey)} />
      <div className="hidden md:flex gap-1 border-b border-border mb-4">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${activeTab === t.key ? "border-primary text-primary" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab !== "waiting" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${statusFilter === f.key ? "border-primary bg-primary/10 text-primary" : "border-border text-ink-secondary hover:bg-muted"}`}>
              {f.label}
            </button>
          ))}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search form or ref no…"
            className="ml-auto h-8 w-full sm:w-56 rounded-md border border-input bg-background px-3 text-sm" />
        </div>
      )}

      {isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : list.length === 0 ? (
        <EmptyState icon={ClipboardCheck}
          title={activeTab === "waiting" ? "Nothing waiting for you" : base.length ? "Nothing matches" : activeTab === "mine" ? "You haven't filled any forms yet" : "No form requests yet"}
          description={activeTab === "mine" && !base.length ? "Open Forms and Formats and click “Fill & Request” on a form. Every form you send stays here — pending, authorized or rejected." : "New requests will appear here."} />
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {list.map((r) => (
            <button key={r.id} onClick={() => open(r.id)}
              className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-primary truncate">
                  {r.form_title}{r.reference_value ? ` · ${r.reference_value}` : ""}
                </p>
                <p className="text-xs text-ink-muted">
                  {names[r.requested_by] ?? "—"} · {format(new Date(r.submitted_at), "d MMM yyyy, h:mm a")} · Authorizer: {names[r.authorizer_id] ?? "—"}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[r.status]}`}>
                {myTurn(r) ? "Your action needed" : STATUS_LABEL[r.status]}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <RequestViewer request={selected} names={names} canDecide={myTurn(selected)}
          canResubmit={selected.status === "rejected" && selected.requested_by === user?.id}
          onClose={close} />
      )}
    </AnimatedPage>
  );
}

function RequestViewer({ request, names, canDecide, canResubmit, onClose }: {
  request: FormRequestRow;
  names: Record<string, string>;
  canDecide: boolean;
  canResubmit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const schema = schemaForTitle(request.form_title);
  const previewRef = useRef<FilledFormHandle>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);

  const decide = useMutation({
    mutationFn: async (approve: boolean) => {
      const { error } = await (supabase as any).rpc("decide_form_request", { p_id: request.id, p_approve: approve, p_reason: approve ? null : reason });
      if (error) throw error;
      return approve;
    },
    onSuccess: (approve) => {
      qc.invalidateQueries({ queryKey: ["form-requests"] });
      toast.success(approve ? "Approved" : "Rejected");
      setRejecting(false);
      setReason("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save your decision"),
  });

  const isApproverStep = request.status === "pending_approval";
  const fileBase = `${request.form_title} ${request.reference_value ?? ""}`.trim().replace(/[\\/]/g, "-");
  const word = async () => {
    const b = previewRef.current?.wordBlob();
    if (!b) { toast.error("The Word copy is still loading"); return; }
    await saveFile(b, `${fileBase}.docx`);
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-4xl max-h-[94dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{request.form_title}{request.reference_value ? ` · ${request.reference_value}` : ""}</DialogTitle>
            <DialogDescription>{STATUS_LABEL[request.status]}</DialogDescription>
          </DialogHeader>

          <div className="overflow-auto max-h-[60dvh] rounded-lg border border-border bg-neutral-200 p-2">
            <FilledFormPreview ref={previewRef} formId={request.form_id} schema={schema} request={request} names={names} />
          </div>

          <FormAttachmentsList value={(request.data as any)?.attachments} />

          {rejecting && (
            <div className="space-y-2">
              <label htmlFor="reject-reason" className="text-sm font-medium text-ink-primary">Reason for rejecting *</label>
              <Textarea id="reject-reason" autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={word} className="gap-1.5">
              <Download className="h-4 w-4" /> Download Word
            </Button>
            {canResubmit && (
              <Button variant="outline" onClick={() => setEditing(true)} className="gap-1.5">
                <Pencil className="h-4 w-4" /> Edit & resubmit
              </Button>
            )}
            {canDecide && !rejecting && (
              <>
                <Button variant="outline" onClick={() => setRejecting(true)} className="gap-1.5 text-destructive hover:text-destructive">
                  <X className="h-4 w-4" /> Reject
                </Button>
                <Button onClick={() => decide.mutate(true)} disabled={decide.isPending} className="gap-1.5 bg-green-600 hover:bg-green-700">
                  <Check className="h-4 w-4" /> {isApproverStep ? "Approve" : "Authorize"}
                </Button>
              </>
            )}
            {canDecide && rejecting && (
              <>
                <Button variant="outline" onClick={() => { setRejecting(false); setReason(""); }}>Cancel</Button>
                <Button variant="destructive" onClick={() => decide.mutate(false)} disabled={decide.isPending || !reason.trim()}>
                  Confirm reject
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <FormRequestDialog open={editing} onClose={() => setEditing(false)} form={null} existing={request} />
    </>
  );
}
