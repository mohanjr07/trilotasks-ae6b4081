// Fill in a form digitally and send it for approval (or edit + resubmit a
// rejected one). Requested by = the logged-in user, Approved by = Hari,
// Authorized by = chosen from the dropdown.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Send, Eye, PencilLine } from "lucide-react";
import FilledFormPreview from "@/components/FilledFormPreview";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { emptyFormData, schemaForTitle, columnTotal, money, type FormData, type FormField } from "@/lib/formSchemas";
import { useFormPeople } from "@/lib/useFormPeople";
import type { FormRequestRow } from "@/components/FormDocument";

export type RequestableForm = {
  id: string;
  title: string;
  ref_number_enabled: boolean;
  ref_prefix: string;
  ref_padding: number;
  current_number: number;
};

export default function FormRequestDialog({
  open, onClose, form, existing, onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  form: RequestableForm | null;
  existing?: FormRequestRow | null;   // set → edit & resubmit
  onSubmitted?: (id: string) => void;
}) {
  const { profile, user } = useAuth();
  const [preview, setPreview] = useState(false);
  const qc = useQueryClient();
  const { names, authorizers } = useFormPeople();
  const title = existing?.form_title ?? form?.title ?? "";
  const schema = schemaForTitle(title);
  const [data, setData] = useState<FormData>(() => emptyFormData(schema));
  const [authorizer, setAuthorizer] = useState("");

  useEffect(() => {
    if (!open) return;
    setPreview(false);
    const base = emptyFormData(schema);
    if (existing) {
      setData({ fields: { ...base.fields, ...(existing.data?.fields ?? {}) }, tables: { ...base.tables, ...(existing.data?.tables ?? {}) } });
      setAuthorizer(existing.authorizer_id);
    } else {
      if ("name" in base.fields && !base.fields.name && profile?.full_name) base.fields.name = profile.full_name;
      setData(base);
      setAuthorizer("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, title]);

  // Running numbers already issued on any form (for reference-number fields)
  const needsMaterialOut = schema.fields.some((f) => f.lookup === "refs");
  const { data: outRefs = [] } = useQuery({
    queryKey: ["form-refs"],
    enabled: open && needsMaterialOut,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("form_refs");
      if (error) throw error;
      const rows = (data ?? []) as Array<{ reference_value: string; form_title: string; project: string | null; issued_at: string }>;
      // Material OUT numbers first (that's what a Material IN usually refers to), then the rest
      return [...rows.filter((r) => /material\s*out/i.test(r.form_title)), ...rows.filter((r) => !/material\s*out/i.test(r.form_title))];
    },
  });

  const setField = (k: string, v: string) => setData((d) => ({ ...d, fields: { ...d.fields, [k]: v } }));
  const setCell = (t: string, i: number, k: string, v: string) =>
    setData((d) => ({ ...d, tables: { ...d.tables, [t]: d.tables[t].map((r, j) => (j === i ? { ...r, [k]: v } : r)) } }));
  const addRow = (t: string, cols: string[]) =>
    setData((d) => ({ ...d, tables: { ...d.tables, [t]: [...(d.tables[t] ?? []), Object.fromEntries(cols.map((c) => [c, ""]))] } }));
  const removeRow = (t: string, i: number) =>
    setData((d) => ({ ...d, tables: { ...d.tables, [t]: d.tables[t].filter((_, j) => j !== i) } }));

  const submit = useMutation({
    mutationFn: async () => {
      const missing = [...schema.fields, ...(schema.footerFields ?? [])].find((f) => f.required && !String(data.fields[f.key] ?? "").trim());
      if (missing) throw new Error(`Please fill "${missing.label}"`);
      if (!authorizer) throw new Error("Choose who will authorize this form");
      // drop completely empty table rows
      const clean: FormData = {
        fields: data.fields,
        tables: Object.fromEntries(Object.entries(data.tables).map(([k, rows]) => [k, rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim()))])),
      };
      if (existing) {
        const { error } = await (supabase as any).rpc("resubmit_form_request", { p_id: existing.id, p_data: clean, p_authorizer: authorizer });
        if (error) throw error;
        return existing.id;
      }
      const { data: id, error } = await (supabase as any).rpc("submit_form_request", { p_form_id: form!.id, p_data: clean, p_authorizer: authorizer });
      if (error) throw error;
      return id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["form-requests"] });
      qc.invalidateQueries({ queryKey: ["production-forms"] });
      toast.success(existing ? "Resubmitted to Hari for approval" : "Sent to Hari for approval");
      onSubmitted?.(id);
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't submit the form"),
  });

  const nextRef = form?.ref_number_enabled
    ? `${form.ref_prefix}${String(form.current_number + 1).padStart(form.ref_padding, "0")}`
    : null;

  const renderField = (f: FormField) => {
    const v = data.fields[f.key] ?? "";
    const common = { id: `f-${f.key}`, value: v, placeholder: f.placeholder };
    return (
      <div key={f.key} className={f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}>
        <label htmlFor={`f-${f.key}`} className="mb-1.5 block text-sm font-medium text-ink-primary">
          {f.label}{f.required && " *"}
        </label>
        {f.type === "textarea" ? (
          <Textarea {...common} rows={3} onChange={(e) => setField(f.key, e.target.value)} />
        ) : f.type === "lookup" ? (
          <>
            <Input {...common} list={`dl-${f.key}`} autoComplete="off"
              onChange={(e) => {
                const val = e.target.value;
                setField(f.key, val);
                const hit = outRefs.find((r) => r.reference_value === val);
                if (hit?.project && !String(data.fields.project ?? "").trim()) setField("project", hit.project);
              }} />
            <datalist id={`dl-${f.key}`}>
              {outRefs.map((r) => (
                <option key={r.reference_value} value={r.reference_value}>
                  {[r.form_title, r.project, r.issued_at ? new Date(r.issued_at).toLocaleDateString("en-IN") : ""].filter(Boolean).join(" · ")}
                </option>
              ))}
            </datalist>
            {needsMaterialOut && outRefs.length === 0 && (
              <p className="mt-1 text-[11px] text-ink-muted">No reference numbers issued yet — you can type one.</p>
            )}
          </>
        ) : f.type === "checks" ? (
          <div className="flex flex-wrap gap-2">
            {(f.options ?? []).map((o) => {
              const picked = v.split(", ").filter(Boolean);
              const on = picked.includes(o);
              return (
                <label key={o} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-ink-secondary"}`}>
                  <input type="checkbox" checked={on}
                    onChange={() => setField(f.key, (f.options ?? []).filter((x) => (x === o ? !on : picked.includes(x))).join(", "))} />
                  {o}
                </label>
              );
            })}
          </div>
        ) : f.type === "select" ? (
          <select {...common} onChange={(e) => setField(f.key, e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Select…</option>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <Input {...common} type={f.type} onChange={(e) => setField(f.key, e.target.value)} />
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit & resubmit" : "Fill & request approval"} — {title}</DialogTitle>
          <DialogDescription>
            {existing?.reference_value ? `Ref No ${existing.reference_value}` : nextRef ? `Ref No will be ${nextRef} (assigned when you submit)` : "Fill the form and send it for approval."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end -mt-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setPreview((v) => !v)}>
            {preview ? <><PencilLine className="h-4 w-4" /> Back to editing</> : <><Eye className="h-4 w-4" /> Preview on the form</>}
          </Button>
        </div>

        {preview && (form?.id || existing?.form_id) && (
          <div className="overflow-auto max-h-[65dvh] rounded-lg border border-border bg-neutral-200 p-2">
            <FilledFormPreview
              formId={(existing?.form_id ?? form?.id)!}
              schema={schema}
              names={{ ...names, ...(user?.id && profile?.full_name ? { [user.id]: profile.full_name } : {}) }}
              request={{
                id: existing?.id ?? "draft", form_id: (existing?.form_id ?? form?.id)!, form_title: title,
                reference_value: existing?.reference_value ?? nextRef, data,
                requested_by: existing?.requested_by ?? user?.id ?? "", approver_id: existing?.approver_id ?? "",
                authorizer_id: authorizer, status: "pending_approval", approved_at: null, authorized_at: null,
                rejected_by: null, rejected_at: null, reject_reason: null,
                submitted_at: new Date().toISOString(), created_at: new Date().toISOString(),
              }}
            />
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}
          className={preview ? "hidden" : "space-y-5"}
        >
          <div className="grid gap-4 sm:grid-cols-2">{schema.fields.map(renderField)}</div>

          {(schema.tables ?? []).map((t) => {
            const rows = data.tables[t.key] ?? [];
            return (
              <div key={t.key}>
                <p className="mb-2 text-sm font-semibold text-ink-primary">{t.label}</p>
                <div className="space-y-3">
                  {rows.map((r, i) => (
                    <div key={i} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-ink-muted">{t.serial ? `#${i + 1}` : `Row ${i + 1}`}</span>
                        {rows.length > 1 && (
                          <button type="button" onClick={() => removeRow(t.key, i)} className="text-ink-muted hover:text-destructive" title="Remove row">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div
                        className="grid gap-2 grid-cols-1 sm:[grid-template-columns:var(--cols)] items-end"
                        style={{ ["--cols" as any]: t.columns.length <= 4
                          ? ["1.6fr", ...Array(t.columns.length - 1).fill("1fr")].join(" ")
                          : "repeat(auto-fill, minmax(150px, 1fr))" }}
                      >
                        {t.columns.map((c) => (
                          <div key={c.key} className="min-w-0">
                            <label className="mb-1 block text-[11px] font-medium text-ink-muted truncate" title={c.label}>{c.label}</label>
                            {c.compute ? (
                              <div className="h-9 flex items-center rounded-md bg-muted px-3 text-sm text-ink-primary">{c.compute(r) || "—"}</div>
                            ) : c.type === "select" ? (
                              <select value={r[c.key] ?? ""} onChange={(e) => setCell(t.key, i, c.key, e.target.value)}
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                                <option value="">—</option>
                                {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : (
                              <Input value={r[c.key] ?? ""} type={c.type ?? "text"} inputMode={c.type === "number" ? "decimal" : undefined}
                                onChange={(e) => setCell(t.key, i, c.key, e.target.value)} className="h-9" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {t.totals?.length ? (
                  <p className="mt-2 text-sm text-ink-secondary">
                    {t.columns.filter((c) => t.totals!.includes(c.key)).map((c) => `${c.label}: ${money(columnTotal(rows, c))}`).join("  ·  ")}
                  </p>
                ) : null}
                <button type="button" onClick={() => addRow(t.key, t.columns.map((c) => c.key))}
                  className="mt-2 flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                  <Plus className="h-4 w-4" /> Add row
                </button>
              </div>
            );
          })}

          {(schema.footerFields ?? []).length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">{(schema.footerFields ?? []).map(renderField)}</div>
          )}

          {schema.summary && schema.summary(data).map((s) => (
            <div key={s.label} className="flex items-center justify-between rounded-lg bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
              <span>{s.label}</span><span>{s.value}</span>
            </div>
          ))}

          {/* Sign-off */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-muted">Requested by</p>
              <p className="text-sm font-semibold text-ink-primary">{(existing && names[existing.requested_by]) || profile?.full_name || "You"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Approved by</p>
              <p className="text-sm font-semibold text-ink-primary">Hari</p>
            </div>
            <div>
              <label htmlFor="authorizer" className="text-xs text-ink-muted">Authorized by *</label>
              <select id="authorizer" value={authorizer} onChange={(e) => setAuthorizer(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="">Choose…</option>
                {authorizers.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submit.isPending} className="gap-1.5">
              <Send className="h-4 w-4" /> {submit.isPending ? "Sending…" : existing ? "Resubmit for approval" : "Send for approval"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
