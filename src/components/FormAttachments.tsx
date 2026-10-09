// Documents attached to a form request (DC, invoice, photos…) — stored in the
// private "form-attachments" bucket; the paths live in form_requests.data.attachments.
import { useState } from "react";
import { Paperclip, X, FileText, Loader2, ExternalLink, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openFileLink } from "@/lib/nativeFiles";
import { toast } from "sonner";

export type FormAttachment = { path: string; name: string; size?: number };

const BUCKET = "form-attachments";
const MAX_MB = 15;

export async function openAttachment(a: FormAttachment) {
  try {
    await openFileLink(async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 300);
      if (error) throw error;
      return data.signedUrl;
    });
  } catch (e: any) {
    toast.error("Could not open the document: " + (e?.message ?? ""));
  }
}

/** Upload / remove documents while filling the form. */
export function FormAttachmentsEditor({ value, onChange, max, label, userId }: {
  value: FormAttachment[]; onChange: (v: FormAttachment[]) => void; max: number; label?: string; userId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);   // uploaded in this session (safe to delete on remove)

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = max - value.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) toast.error(`You can attach up to ${max} documents`);
    setUploading(true);
    const added: FormAttachment[] = [];
    for (const f of list) {
      if (f.size > MAX_MB * 1024 * 1024) { toast.error(`${f.name} is larger than ${MAX_MB} MB`); continue; }
      const path = `${userId}/${Date.now()}_${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (error) { toast.error(`Could not upload ${f.name}: ${error.message}`); continue; }
      added.push({ path, name: f.name, size: f.size });
    }
    setUploading(false);
    if (added.length) { onChange([...value, ...added]); setFresh((f) => [...f, ...added.map((a) => a.path)]); }
  };

  const remove = async (a: FormAttachment) => {
    onChange(value.filter((x) => x.path !== a.path));
    // tidy up only files uploaded in this session — saved ones stay until the form is resubmitted
    if (fresh.includes(a.path)) await supabase.storage.from(BUCKET).remove([a.path]).catch(() => {});
  };

  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-ink-primary">
        {label ?? "Attachments"} <span className="font-normal text-ink-muted">({value.length}/{max})</span>
      </p>
      <div className="space-y-2">
        {value.map((a) => (
          <div key={a.path} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-ink-muted" />
            <button type="button" onClick={() => openAttachment(a)} className="min-w-0 flex-1 truncate text-left text-ink-primary hover:underline">{a.name}</button>
            <button type="button" onClick={() => remove(a)} className="rounded p-1 text-ink-muted hover:text-destructive hover:bg-destructive/10" aria-label={`Remove ${a.name}`}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        {value.length < max && (
          <label className={`flex items-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-3 text-sm ${uploading ? "opacity-60" : "cursor-pointer hover:bg-muted/40"}`}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin text-ink-muted" /> : <Upload className="h-4 w-4 text-ink-muted" />}
            <span className="text-ink-secondary">{uploading ? "Uploading…" : "Tap to upload a photo, PDF or document"}</span>
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" disabled={uploading}
              onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
          </label>
        )}
      </div>
    </div>
  );
}

/** Read-only list on the request viewer. */
export function FormAttachmentsList({ value }: { value?: FormAttachment[] | null }) {
  if (!value?.length) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink-primary">
        <Paperclip className="h-4 w-4" /> Attachments ({value.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {value.map((a) => (
          <button key={a.path} type="button" onClick={() => openAttachment(a)}
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm text-ink-primary hover:bg-muted">
            <FileText className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="truncate max-w-[220px]">{a.name}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
