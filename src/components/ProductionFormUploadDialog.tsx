import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import {
  listWordBookmarksWithParts,
  listSheetNames,
  loadWorkbook,
  loadDocxZip,
} from "@/lib/productionForms";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type FileType = "word" | "excel";

export default function ProductionFormUploadDialog({ open, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<FileType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Word
  const [bookmarks, setBookmarks] = useState<{ name: string; part: string }[]>([]);
  const [selectedBookmark, setSelectedBookmark] = useState("");

  // Excel
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [cellRef, setCellRef] = useState("");

  const [prefix, setPrefix] = useState("");
  const [padding, setPadding] = useState(3);

  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFile(null);
    setFileType(null);
    setTitle("");
    setDescription("");
    setBookmarks([]);
    setSelectedBookmark("");
    setSheets([]);
    setSelectedSheet("");
    setCellRef("");
    setPrefix("");
    setPadding(3);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const isWord = /\.docx$/i.test(f.name);
    const isExcel = /\.xlsx$/i.test(f.name);
    if (!isWord && !isExcel) {
      toast.error("Please choose a .docx or .xlsx file");
      return;
    }

    setFile(f);
    setFileType(isWord ? "word" : "excel");
    if (!title) setTitle(f.name.replace(/\.(docx|xlsx)$/i, ""));

    setAnalyzing(true);
    try {
      const buf = await f.arrayBuffer();
      if (isWord) {
        const zip = await loadDocxZip(buf);
        const found = await listWordBookmarksWithParts(zip);
        setBookmarks(found);
        setSelectedBookmark(found[0]?.name ?? "");
        if (found.length === 0) {
          toast.error("No bookmarks found in this document. In Word, select the spot for the reference number and add a Bookmark (Insert → Bookmark) before uploading.");
        }
      } else {
        const wb = await loadWorkbook(buf);
        const names = listSheetNames(wb);
        setSheets(names);
        setSelectedSheet(names[0] ?? "");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that file");
      setFile(null);
      setFileType(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const canSave =
    !!file &&
    !!title.trim() &&
    (fileType === "word" ? !!selectedBookmark : !!selectedSheet && !!cellRef.trim()) &&
    padding >= 1 &&
    padding <= 10;

  const handleSave = async () => {
    if (!file || !fileType || !user) return;
    setSaving(true);
    try {
      const ext = fileType === "word" ? "docx" : "xlsx";
      const path = `${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("production-forms")
        .upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const bookmarkMeta = bookmarks.find((b) => b.name === selectedBookmark);
      const field_locator =
        fileType === "word"
          ? { type: "bookmark" as const, name: selectedBookmark, part: bookmarkMeta?.part ?? "word/document.xml" }
          : { type: "cell" as const, sheet: selectedSheet, cell: cellRef.trim().toUpperCase() };

      const { error: insertError } = await supabase.from("production_forms").insert({
        title: title.trim(),
        description: description.trim() || null,
        file_type: fileType,
        storage_path: path,
        original_filename: file.name,
        field_locator,
        ref_prefix: prefix,
        ref_padding: padding,
        current_number: 0,
        created_by: user.id,
      });
      if (insertError) {
        // Roll back the upload so we don't leave an orphaned file behind.
        await supabase.storage.from("production-forms").remove([path]);
        throw insertError;
      }

      toast.success("Form uploaded");
      onCreated();
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload form");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Form</DialogTitle>
          <DialogDescription>
            Upload a Word or Excel template, then choose which field holds the running reference number.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>File (.docx or .xlsx)</Label>
            <input
              ref={inputRef}
              type="file"
              accept=".docx,.xlsx"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button variant="outline" onClick={() => inputRef.current?.click()} className="gap-2 w-full justify-start" disabled={analyzing}>
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {file ? file.name : "Choose file…"}
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Work Order Form" />
          </div>

          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          {fileType === "word" && file && !analyzing && (
            <div className="space-y-2">
              <Label>Reference number bookmark</Label>
              {bookmarks.length === 0 ? (
                <p className="text-xs text-destructive">
                  No bookmarks found. Add one in Word (Insert → Bookmark) at the spot for the reference number, then re-upload.
                </p>
              ) : (
                <Select value={selectedBookmark} onValueChange={setSelectedBookmark}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {bookmarks.map((b) => (
                      <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {fileType === "excel" && file && !analyzing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Sheet</Label>
                <Select value={selectedSheet} onValueChange={setSelectedSheet}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cell (e.g. B2)</Label>
                <Input value={cellRef} onChange={(e) => setCellRef(e.target.value)} placeholder="B2" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Prefix (optional)</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. PF-2026-" />
            </div>
            <div className="space-y-2">
              <Label>Digits</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            First open will produce <span className="font-mono">{prefix}{String(1).padStart(padding, "0")}</span>, then {prefix}{String(2).padStart(padding, "0")}, and so on.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
