import { useEffect, useState } from "react";
import { Camera, FileText, ImageIcon, Upload, X } from "lucide-react";

/** Take a photo, choose an image from the gallery, or pick a file (PDF, Word, Excel). */
export function FilePickButtons({ onPick }: { onPick: (f: File) => void }) {
  const take = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; };
  const btn = "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background px-2 py-3 text-xs font-medium text-ink-secondary hover:bg-muted/40";
  return (
    <div className="grid grid-cols-3 gap-2">
      <label className={btn}><Camera className="h-5 w-5 text-ink-muted" /> Take photo
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={take} /></label>
      <label className={btn}><ImageIcon className="h-5 w-5 text-ink-muted" /> Choose image
        <input type="file" accept="image/*" className="hidden" onChange={take} /></label>
      <label className={btn}><Upload className="h-5 w-5 text-ink-muted" /> Upload file
        <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={take} /></label>
      <p className="col-span-3 hidden text-center text-[11px] text-ink-muted sm:block">or drag &amp; drop a file here</p>
    </div>
  );
}

/** The chosen file — a thumbnail for images. */
export function PickedFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) { setUrl(null); return; }
    const u = URL.createObjectURL(file); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-2 text-sm">
      {url ? <img src={url} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
           : <FileText className="ml-1 h-5 w-5 shrink-0 text-ink-muted" />}
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <button type="button" onClick={onRemove} className="p-1 text-ink-muted hover:text-destructive" aria-label="Remove file"><X className="h-4 w-4" /></button>
    </div>
  );
}

