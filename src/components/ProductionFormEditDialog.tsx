import { useEffect, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { renderAsync as renderDocxPreview } from "docx-preview";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Download, CheckCircle2, Eye, Pencil, Save } from "lucide-react";
import type { ProductionForm } from "@/pages/ProductionFormsPage";
import {
  formatRefNumber,
  loadDocxZip,
  getXmlPart,
  setWordBookmarkText,
  docxToHtml,
  htmlToDocxBlob,
  loadWorkbook,
  setCellValue,
  sheetToGrid,
  workbookToBlob,
  columnLetter,
  type ExcelFieldLocator,
  type WordFieldLocator,
} from "@/lib/productionForms";
import { saveFile } from "@/lib/nativeFiles";

type Props = {
  form: ProductionForm;
  onClose: () => void;
  onSaved: () => void;
};

const BUCKET = "production-forms";

export default function ProductionFormEditDialog({ form, onClose, onSaved }: Props) {
  const refEnabled = form.ref_number_enabled;

  const [loading, setLoading] = useState(true);
  const [using, setUsing] = useState(false);
  const [saving, setSaving] = useState(false);
  // For ref-number forms: becomes true only after "Use This" successfully
  // assigns + saves the real number — Download stays locked until then.
  // For forms with no reference number, there's nothing to gate on, so
  // Download is available as soon as the file loads.
  const [used, setUsed] = useState(!refEnabled);
  const [referenceValue, setReferenceValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Word state
  const [html, setHtml] = useState<string>("");
  const editorRef = useRef<HTMLDivElement>(null);
  // Accurate, read-only rendering (headers/footers/tables/layout) — the real
  // document, not the simplified mammoth body-only conversion. Defaults to
  // this view so what's shown actually matches the original form.
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const previewRef = useRef<HTMLDivElement>(null);
  // A preview render — with the *next* reference number patched in when this
  // form uses one — purely for display. Nothing is uploaded until "Use
  // This"/"Save" is clicked.
  const [originalBuffer, setOriginalBuffer] = useState<ArrayBuffer | null>(null);
  // The untouched original bytes, kept so "Use This" can patch in the real
  // (RPC-assigned) number without losing header/table/style fidelity.
  const rawBufferRef = useRef<ArrayBuffer | null>(null);
  const [edited, setEdited] = useState(false);

  // Excel state
  const wbRef = useRef<ExcelJS.Workbook | null>(null);
  const [grid, setGrid] = useState<string[][]>([]);
  const sheetNameRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setUsed(!refEnabled);
      setEdited(false);
      setViewMode("preview");
      setOriginalBuffer(null);
      rawBufferRef.current = null;
      try {
        // Just a preview of what "Use This" would assign — the counter isn't
        // touched here, so opening the form to look at it is free.
        let previewValue = "";
        if (refEnabled) {
          previewValue = formatRefNumber(form.ref_prefix, form.ref_padding, form.current_number + 1);
          if (cancelled) return;
          setReferenceValue(previewValue);
        }

        const { data: blob, error: downloadError } = await supabase.storage
          .from(BUCKET)
          .download(form.storage_path);
        if (downloadError) throw downloadError;
        const buffer = await blob.arrayBuffer();

        if (form.file_type === "word") {
          rawBufferRef.current = buffer;
          let bufferForPreview = buffer;

          if (refEnabled && form.field_locator) {
            const locator = form.field_locator as WordFieldLocator;
            // Older forms saved before header/footer support default to the body.
            const part = locator.part || "word/document.xml";
            const zip = await loadDocxZip(buffer);
            const xml = await getXmlPart(zip, part);
            const patchedXml = setWordBookmarkText(xml, locator.name, previewValue);
            zip.file(part, patchedXml);
            bufferForPreview = await zip.generateAsync({ type: "arraybuffer" });
          }

          const renderedHtml = await docxToHtml(bufferForPreview);
          if (cancelled) return;
          setHtml(renderedHtml);
          setOriginalBuffer(bufferForPreview);
        } else {
          const wb = await loadWorkbook(buffer);

          if (refEnabled && form.field_locator) {
            const locator = form.field_locator as ExcelFieldLocator;
            setCellValue(wb, locator.sheet, locator.cell, previewValue);
            sheetNameRef.current = locator.sheet;
          } else {
            sheetNameRef.current = wb.worksheets[0]?.name ?? "";
          }

          wbRef.current = wb;
          if (cancelled) return;
          setGrid(sheetToGrid(wb, sheetNameRef.current, 200, 40).cells);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to open this form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id]);

  // Render the true document (header, footer, tables, layout) into the
  // Preview pane once the patched file is ready and its container is
  // mounted. Kept separate from viewMode so switching tabs is instant —
  // both panes exist in the DOM at once, toggled with a CSS class.
  useEffect(() => {
    if (loading || !originalBuffer || !previewRef.current) return;
    const container = previewRef.current;
    container.innerHTML = "";
    renderDocxPreview(originalBuffer, container, container, {
      className: "docx-preview",
      inWrapper: true,
      ignoreHeight: true,
    }).catch(() => {
      // Best-effort — Edit tab and Download still work even if this fails.
    });
  }, [originalBuffer, loading]);

  const handleCellChange = (rowIdx: number, colIdx: number, value: string) => {
    setEdited(true);
    setGrid((prev) => {
      const next = prev.map((row) => row.slice());
      next[rowIdx][colIdx] = value;
      return next;
    });
    if (wbRef.current) {
      const address = `${columnLetter(colIdx + 1)}${rowIdx + 1}`;
      setCellValue(wbRef.current, sheetNameRef.current, address, value);
    }
  };

  const handleDownload = async () => {
    if (!used) return; // button is disabled until then, this is just a guard
    try {
      let blob: Blob;
      if (form.file_type === "excel" && wbRef.current) {
        blob = await workbookToBlob(wbRef.current);
      } else if (form.file_type === "word" && !edited && originalBuffer) {
        // Nothing was edited — hand back the real file (with the ref number
        // already patched in, if this form uses one) instead of
        // round-tripping through the simplified HTML converter and losing
        // headers/tables/styling.
        blob = new Blob([originalBuffer], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      } else {
        const container = editorRef.current;
        blob = await htmlToDocxBlob(container?.innerHTML ?? html);
      }
      await saveFile(blob, form.original_filename);
    } catch {
      toast.error("Couldn't prepare the file for download");
    }
  };

  // The single action that both assigns the real reference number and saves
  // the file — only used for forms with reference numbers turned on. Only
  // takes effect once; the counter is a shared resource, so this can't be
  // re-run in the same session without burning another number.
  const handleUseThis = async () => {
    setUsing(true);
    try {
      const { data: rows, error: rpcError } = await supabase.rpc("open_production_form", {
        p_form_id: form.id,
      });
      if (rpcError) throw rpcError;
      const result = rows?.[0];
      if (!result) throw new Error("Couldn't reserve a reference number for this form.");

      let blob: Blob;
      if (form.file_type === "word") {
        const locator = result.field_locator as unknown as WordFieldLocator;
        const part = locator.part || "word/document.xml";

        if (edited) {
          // Body text was customized — regenerate from the edited HTML.
          // (Basic formatting only; headers/tables aren't reproduced here,
          // same tradeoff as the Edit tab always had.)
          const editedHtml = editorRef.current?.innerHTML ?? html;
          blob = await htmlToDocxBlob(editedHtml);
        } else if (rawBufferRef.current) {
          const zip = await loadDocxZip(rawBufferRef.current);
          const xml = await getXmlPart(zip, part);
          const patchedXml = setWordBookmarkText(xml, locator.name, result.reference_value);
          zip.file(part, patchedXml);
          const patchedBuffer = await zip.generateAsync({ type: "arraybuffer" });
          blob = new Blob([patchedBuffer], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
          setOriginalBuffer(patchedBuffer);
          setHtml(await docxToHtml(patchedBuffer));
        } else {
          throw new Error("Missing the original file — try closing and reopening this form.");
        }
      } else {
        const locator = result.field_locator as unknown as ExcelFieldLocator;
        if (!wbRef.current) throw new Error("Missing the workbook — try closing and reopening this form.");
        setCellValue(wbRef.current, locator.sheet, locator.cell, result.reference_value);
        blob = await workbookToBlob(wbRef.current);
        setGrid(sheetToGrid(wbRef.current, locator.sheet, 200, 40).cells);
      }

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(result.storage_path, blob, { upsert: true });
      if (upErr) throw upErr;

      setReferenceValue(result.reference_value);
      setUsed(true);
      toast.success(`Reference number ${result.reference_value} assigned`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign a reference number");
    } finally {
      setUsing(false);
    }
  };

  // For forms with no reference number — just persist whatever was edited.
  // Download already works without this; Save only matters if something
  // was actually changed.
  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      let blob: Blob;
      if (form.file_type === "excel") {
        if (!wbRef.current) throw new Error("Nothing to save yet");
        blob = await workbookToBlob(wbRef.current);
      } else {
        const editedHtml = editorRef.current?.innerHTML ?? html;
        blob = await htmlToDocxBlob(editedHtml);
      }
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(form.storage_path, blob, { upsert: true });
      if (upErr) throw upErr;
      toast.success("Saved");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle>{form.title}</DialogTitle>
            {refEnabled && referenceValue && (
              <Badge variant={used ? "default" : "secondary"} className="font-mono">
                {used ? referenceValue : `Next: ${referenceValue}`}
              </Badge>
            )}
          </div>
          <DialogDescription>
            {refEnabled
              ? form.file_type === "word"
                ? "Preview shows the actual document — header, tables, and layout included. Nothing is assigned or saved yet: click \"Use This\" to lock in this reference number and unlock Download."
                : "Edit cells directly, then click \"Use This\" to lock in this reference number, save the file, and unlock Download."
              : "This form doesn't use a reference number. Download is available right away — use Save if you make changes."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto border border-border rounded-lg">
          {loading && (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {!loading && error && (
            <div className="p-8 text-center text-sm text-destructive">{error}</div>
          )}

          {!loading && !error && form.file_type === "word" && (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2 bg-muted/30 shrink-0">
                <Button
                  size="sm"
                  variant={viewMode === "preview" ? "secondary" : "ghost"}
                  onClick={() => setViewMode("preview")}
                  className="gap-1.5 h-7 px-2 text-xs"
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "edit" ? "secondary" : "ghost"}
                  onClick={() => setViewMode("edit")}
                  className="gap-1.5 h-7 px-2 text-xs"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit body text
                </Button>
              </div>
              <div
                ref={previewRef}
                className={viewMode === "preview" ? "p-4 overflow-auto" : "hidden"}
              />
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={() => setEdited(true)}
                className={
                  viewMode === "edit"
                    ? "prose prose-sm max-w-none p-6 focus:outline-none"
                    : "hidden"
                }
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          )}

          {!loading && !error && form.file_type === "excel" && (
            <table className="text-xs border-collapse">
              <tbody>
                {grid.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, colIdx) => (
                      <td key={colIdx} className="border border-border p-0">
                        <input
                          value={cell}
                          onChange={(e) => handleCellChange(rowIdx, colIdx, e.target.value)}
                          className="w-20 px-1.5 py-1 bg-transparent outline-none focus:bg-accent-light"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleDownload} disabled={loading || !!error || !used} className="gap-2">
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {refEnabled ? (
            <Button onClick={handleUseThis} disabled={loading || !!error || using || used} className="gap-2">
              {used ? <CheckCircle2 className="h-4 w-4" /> : null}
              {using ? "Assigning…" : used ? "Used" : "Use This"}
            </Button>
          ) : (
            <Button onClick={handleSaveEdits} disabled={loading || !!error || saving || !edited} className="gap-2">
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
