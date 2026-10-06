// Shows the company's ORIGINAL Word form, filled in with the request's
// values and approval status. The filled .docx is put in the private
// "form-copies" bucket and shown through Microsoft's Office viewer (looks
// exactly like Word) using a 15-minute signed link. Falls back to an in-app
// render (docx-preview), then to the simple built-in layout.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { renderAsync } from "docx-preview";
import { supabase } from "@/integrations/supabase/client";
import { buildFilledDocx } from "@/lib/formDocx";
import type { FormSchema } from "@/lib/formSchemas";
import type { WordFieldLocator } from "@/lib/productionForms";
import FormDocument, { type FormRequestRow } from "@/components/FormDocument";

export type FilledFormHandle = { element: () => HTMLElement | null; wordBlob: () => Blob | null };

function useTemplate(formId: string) {
  return useQuery({
    queryKey: ["form-template", formId],
    queryFn: async () => {
      const { data: form, error } = await supabase
        .from("production_forms").select("storage_path, field_locator, file_type").eq("id", formId).single();
      if (error) throw error;
      if ((form as any).file_type !== "word") throw new Error("not a Word form");
      const { data: blob, error: dlErr } = await supabase.storage.from("production-forms").download((form as any).storage_path);
      if (dlErr || !blob) throw dlErr ?? new Error("download failed");
      return { buffer: await blob.arrayBuffer(), locator: ((form as any).field_locator ?? null) as WordFieldLocator | null };
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}

const FilledFormPreview = forwardRef<FilledFormHandle, {
  formId: string;
  schema: FormSchema;
  request: FormRequestRow;
  names: Record<string, string>;
}>(function FilledFormPreview({ formId, schema, request, names }, ref) {
  const tpl = useTemplate(formId);
  const hostRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [officeUrl, setOfficeUrl] = useState<string | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  useEffect(() => setFrameLoaded(false), [officeUrl]);

  useImperativeHandle(ref, () => ({
    element: () => (failed || tpl.isError ? fallbackRef.current : hostRef.current),
    wordBlob: () => blob,
  }), [failed, tpl.isError, blob]);

  const key = JSON.stringify([request.data, request.status, request.approved_at, request.authorized_at, request.rejected_at, request.reference_value, names[request.requested_by]]);
  useEffect(() => {
    if (!tpl.data || !hostRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const filled = await buildFilledDocx(tpl.data.buffer.slice(0), schema, request, names, tpl.data.locator);
        if (cancelled) return;
        setBlob(filled);
        // 1) exact rendering via Microsoft's Office viewer
        try {
          const path = request.id === "draft" ? `drafts/${request.requested_by || "me"}.docx` : `${request.id}.docx`;
          const { error: upErr } = await supabase.storage.from("form-copies").upload(path, filled, {
            upsert: true,
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
          if (upErr) throw upErr;
          const { data: signed, error: sErr } = await supabase.storage.from("form-copies").createSignedUrl(path, 15 * 60);
          if (sErr || !signed?.signedUrl) throw sErr ?? new Error("no link");
          const abs = new URL(signed.signedUrl, window.location.origin).toString();
          if (!cancelled) {
            setOfficeUrl(`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(abs)}`);
            setFailed(false);
          }
          return;
        } catch {
          // fall through to the in-app render
        }
        if (cancelled || !hostRef.current) return;
        setOfficeUrl(null);
        hostRef.current.innerHTML = "";
        await renderAsync(filled, hostRef.current, hostRef.current, { className: "docx-preview", inWrapper: false, ignoreHeight: true, breakPages: true });
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl.data, key]);

  if (tpl.isError || failed) {
    return <FormDocument ref={fallbackRef} schema={schema} request={request} names={names} />;
  }
  return (
    <div className="bg-white text-black">
      {(tpl.isLoading || (!officeUrl && !blob)) && <div className="p-10 text-center text-sm text-neutral-500">Loading form…</div>}
      {officeUrl && (
        <div className="relative">
          {!frameLoaded && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500 bg-white">
              Opening the form… (a few seconds)
            </div>
          )}
          <iframe key={officeUrl} src={officeUrl} title="Form" onLoad={() => setTimeout(() => setFrameLoaded(true), 1500)}
            className="w-full h-[58dvh] border-0 bg-white" />
        </div>
      )}
      <div ref={hostRef} className={officeUrl ? "hidden" : "docx-host"} />
    </div>
  );
});

export default FilledFormPreview;
