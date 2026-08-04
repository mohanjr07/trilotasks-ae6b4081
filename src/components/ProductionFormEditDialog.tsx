import { useEffect, useRef, useState } from "react";
import ExcelJS from "exceljs";
import JSZip from "jszip";
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
import { Loader2, Download, Save } from "lucide-react";
import type { ProductionForm } from "@/pages/ProductionFormsPage";
import {
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

type Props = {
  form: ProductionForm;
  onClose: () => void;
  onSaved: () => void;
};

const BUCKET = "production-forms";

export default function ProductionFormEditDialog({ form, onClose, onSaved }: Props) {
  const isHeaderFooterBookmark =
    form.file_type === "word" &&
    (form.field_locator as WordFieldLocator).part !== undefined &&
    (form.field_locator as WordFieldLocator).part !== "word/document.xml";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [referenceValue, setReferenceValue] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Word state
  const [html, setHtml] = useState<string>("");
  const editorRef = useRef<HTMLDivElement>(null);

  // Excel state
  const wbRef = useRef<ExcelJS.Workbook | null>(null);
  const [grid, setGrid] = useState<string[][]>([]);
  const sheetNameRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const { data: rows, error: rpcError } = await supabase.rpc("open_production_form", {
          p_form_id: form.id,
        });
        if (rpcError) throw rpcError;
        const result = rows?.[0];
        if (!result) throw new Error("Couldn't open this form.");
        if (cancelled) return;
        setReferenceValue(result.reference_value);

        const { data: blob, error: downloadError } = await supabase.storage
          .from(BUCKET)
          .download(result.storage_path);
        if (downloadError) throw downloadError;
        const buffer = await blob.arrayBuffer();

        if (result.file_type === "word") {
          const locator = result.field_locator as unknown as WordFieldLocator;
          // Older forms saved before header/footer support default to the body.
          const part = locator.part || "word/document.xml";
          const zip = await loadDocxZip(buffer);
          const xml = await getXmlPart(zip, part);
          const patchedXml = setWordBookmarkText(xml, locator.name, result.reference_value);
          zip.file(part, patchedXml);
          const patchedBuffer = await zip.generateAsync({ type: "arraybuffer" });

          // Persist the number bump immediately — it should stick even if the
          // user never touches the body content.
          const patchedBlob = new Blob([patchedBuffer], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(result.storage_path, patchedBlob, { upsert: true });
          if (upErr) throw upErr;

          const renderedHtml = await docxToHtml(patchedBuffer);
          if (cancelled) return;
          setHtml(renderedHtml);
        } else {
          const locator = result.field_locator as unknown as ExcelFieldLocator;
          const wb = await loadWorkbook(buffer);
          setCellValue(wb, locator.sheet, locator.cell, result.reference_value);

          const patchedBlob = await workbookToBlob(wb);
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(result.storage_path, patchedBlob, { upsert: true });
          if (upErr) throw upErr;

          wbRef.current = wb;
          sheetNameRef.current = locator.sheet;
          if (cancelled) return;
          setGrid(sheetToGrid(wb, locator.sheet, 200, 40).cells);
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

  const handleCellChange = (rowIdx: number, colIdx: number, value: string) => {
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
    try {
      let blob: Blob;
      if (form.file_type === "excel" && wbRef.current) {
        blob = await workbookToBlob(wbRef.current);
      } else {
        const container = editorRef.current;
        blob = await htmlToDocxBlob(container?.innerHTML ?? html);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = form.original_filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't prepare the file for download");
    }
  };

  const handleSave = async () => {
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
            {referenceValue && <Badge className="font-mono">{referenceValue}</Badge>}
          </div>
          <DialogDescription>
            {form.file_type === "word"
              ? isHeaderFooterBookmark
                ? "The reference number lives in this document's header/footer, so it won't appear in the preview below — but it's already updated in the file. Download to confirm, or use Save after editing the body text."
                : "Basic formatting only (bold, italics, headings, lists). For complex layouts, use Download and edit in Word."
              : "Edit cells directly, then save. Formulas and formatting from the original file are preserved."}
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
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="prose prose-sm max-w-none p-6 focus:outline-none"
              dangerouslySetInnerHTML={{ __html: html }}
            />
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
          <Button variant="outline" onClick={handleDownload} disabled={loading || !!error} className="gap-2">
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleSave} disabled={loading || !!error || saving} className="gap-2">
            <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
