import { useState, useEffect, useCallback, useRef, type ChangeEvent, type DragEvent, type ClipboardEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, StickyNote, Check, Loader2, Pencil, ImagePlus, X } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import DrawingCanvas, { type Stroke } from "@/components/DrawingCanvas";

const DRAWING_PREFIX = "__drawing__:";
const isDrawing = (content: string) => content?.startsWith(DRAWING_PREFIX);

// Drawing-note storage layout:
//   __drawing__:<json-array-of-strokes>
//   [[image:path1]]
//   [[image:path2]]
//
// The JSON ends at the first newline after the prefix. Image markers that
// follow share the same `[[image:...]]` syntax as text notes, so the existing
// extractImagePaths / IMAGE_TOKEN_RE keep working on drawing content too.
// Pure-stroke notes (no images, no trailing newline) stay readable as before.
function drawingBody(content: string): string {
  if (!isDrawing(content)) return "";
  const after = content.slice(DRAWING_PREFIX.length);
  const nl = after.indexOf("\n");
  return nl === -1 ? after : after.slice(0, nl);
}
function drawingTail(content: string): string {
  if (!isDrawing(content)) return "";
  const after = content.slice(DRAWING_PREFIX.length);
  const nl = after.indexOf("\n");
  return nl === -1 ? "" : after.slice(nl + 1);
}
const parseDrawing = (content: string): Stroke[] => {
  try {
    return JSON.parse(drawingBody(content)) as Stroke[];
  } catch {
    return [];
  }
};
// Preserve any trailing image markers when re-serializing strokes.
const serializeDrawing = (strokes: Stroke[], tail: string = "") => {
  const head = DRAWING_PREFIX + JSON.stringify(strokes);
  return tail ? `${head}\n${tail}` : head;
};

// Inline image markers live inside `content` as their own line:
//   [[image:<storage-path>]]
// Storing the path (not a URL) means we can re-sign URLs whenever they expire
// and we don't poison the saved content with short-lived links.
const IMAGE_BUCKET = "note-images";
const IMAGE_TOKEN_RE = /\[\[image:([^\]]+)\]\]/g;

type Note = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type SaveStatus = "idle" | "saving" | "saved";

// Split a note's content into ordered text / image blocks so we can render
// images inline between paragraphs of typed text — exactly the way Apple
// Notes interleaves them.
type Block =
  | { kind: "text"; value: string }
  | { kind: "image"; path: string };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let lastIndex = 0;
  const re = new RegExp(IMAGE_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      blocks.push({ kind: "text", value: content.slice(lastIndex, m.index) });
    }
    blocks.push({ kind: "image", path: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    blocks.push({ kind: "text", value: content.slice(lastIndex) });
  }
  return blocks;
}

function extractImagePaths(content: string): string[] {
  const out: string[] = [];
  const re = new RegExp(IMAGE_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push(m[1]);
  return out;
}

function stripImages(content: string): string {
  // Only remove the markers themselves — never touch surrounding whitespace,
  // otherwise the user's own newlines (Enter key) get eaten on every keystroke.
  return content.replace(IMAGE_TOKEN_RE, "");
}

export default function NotesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // A drag entering a child fires another `dragenter` before the parent's
  // `dragleave`, so we count enters/leaves to know when we've truly left.
  const dragDepth = useRef(0);
  // Signed-URL cache so a re-render doesn't re-fetch the same URL.
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ["user_notes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_notes")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Note[];
    },
    enabled: !!user,
  });

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  const createMutation = useMutation({
    mutationFn: async (kind: "text" | "drawing" = "text") => {
      const initialContent = kind === "drawing" ? serializeDrawing([]) : "";
      const initialTitle = kind === "drawing" ? "Untitled Drawing" : "Untitled Note";
      const { data, error } = await supabase
        .from("user_notes")
        .insert({ user_id: user!.id, title: initialTitle, content: initialContent })
        .select()
        .single();
      if (error) throw error;
      return data as Note;
    },
    onSuccess: (newNote) => {
      queryClient.invalidateQueries({ queryKey: ["user_notes"] });
      setSelectedId(newNote.id);
    },
    onError: () => toast.error("Failed to create note"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, title, content }: { id: string; title: string; content: string }) => {
      const { error } = await supabase
        .from("user_notes")
        .update({ title, content })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      setSaveStatuses((prev) => ({ ...prev, [variables.id]: "saved" }));
      queryClient.invalidateQueries({ queryKey: ["user_notes"] });
    },
    onError: () => toast.error("Failed to save note"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Best-effort: also remove any images this note owned so we don't leak storage.
      const note = notes.find((n) => n.id === id);
      const paths = note ? extractImagePaths(note.content || "") : [];
      if (paths.length > 0) {
        await supabase.storage.from(IMAGE_BUCKET).remove(paths).catch(() => {});
      }
      const { error } = await supabase.from("user_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      if (selectedId === id) setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["user_notes"] });
      toast.success("Note deleted");
    },
    onError: () => toast.error("Failed to delete note"),
  });

  const debouncedSave = useCallback(
    (id: string, title: string, content: string) => {
      setSaveStatuses((prev) => ({ ...prev, [id]: "saving" }));
      if (debounceTimers.current[id]) clearTimeout(debounceTimers.current[id]);
      debounceTimers.current[id] = setTimeout(() => {
        updateMutation.mutate({ id, title, content });
      }, 1200);
    },
    [updateMutation]
  );

  // Cleanup timers
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  // Fetch signed URLs for every image referenced by the *selected* note.
  // 1 hour TTL is plenty for an editing session; the cache is in-memory so it
  // refreshes naturally on remount/reload.
  useEffect(() => {
    if (!selectedNote) return;
    const paths = extractImagePaths(selectedNote.content || "");
    const missing = paths.filter((p) => !signedUrls[p]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      for (const p of missing) {
        const { data, error } = await supabase.storage
          .from(IMAGE_BUCKET)
          .createSignedUrl(p, 60 * 60);
        if (!error && data?.signedUrl) updates[p] = data.signedUrl;
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setSignedUrls((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [selectedNote, signedUrls]);

  const handleFieldChange = (field: "title" | "content", value: string) => {
    if (!selectedNote) return;
    // Optimistically update the cache so the UI is instant
    queryClient.setQueryData<Note[]>(["user_notes"], (old) =>
      (old ?? []).map((n) => (n.id === selectedNote.id ? { ...n, [field]: value } : n))
    );
    const updated = { ...selectedNote, [field]: value };
    debouncedSave(updated.id, updated.title, updated.content);
  };

  // Text-only content (no image markers) — what the textarea actually edits.
  // When the user types, we splice their text back into the content while
  // preserving every image marker in its original position.
  const textOnly = selectedNote ? stripImages(selectedNote.content || "") : "";

  const handleTextChange = (newText: string) => {
    if (!selectedNote) return;
    const imageBlocks = parseBlocks(selectedNote.content || "").filter(
      (b) => b.kind === "image",
    ) as Extract<Block, { kind: "image" }>[];
    // Append every existing image marker after the new text so we don't lose them.
    // (Images stay attached to the note; they render below typed text. If you
    // want true interleaving with the typed text, see the inline rendering
    // below — the markers stay in `content` order.)
    // Concatenate markers directly with no extra whitespace — rendering uses
    // parseBlocks so the marker still renders as its own block, and avoiding
    // injected newlines keeps stripImages(content) === user's typed text.
    const next =
      newText + imageBlocks.map((b) => `[[image:${b.path}]]`).join("");
    handleFieldChange("content", next);
  };

  const handleAttachClick = () => {
    if (!selectedNote || uploading) return;
    fileInputRef.current?.click();
  };

  // Shared upload path used by the file picker, drag-drop, and clipboard paste.
  // Returns true on success so callers can chain (e.g. for batch drops).
  const uploadImageFile = async (file: File): Promise<boolean> => {
    if (!selectedNote || !user) return false;

    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are allowed");
      return false;
    }
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Image must be under ${MAX_MB}MB`);
      return false;
    }

    try {
      // Path layout: <uid>/<note-id>/<timestamp>-<safeName>
      // The uid prefix is what the storage RLS policy checks against.
      const safeName = (file.name || "image.png").replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${user.id}/${selectedNote.id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      // Append the marker. Newline padding keeps it on its own visual block.
      // We re-read from the query cache so successive uploads in the same drop
      // batch don't clobber each other's appends.
      const latest = queryClient
        .getQueryData<Note[]>(["user_notes"])
        ?.find((n) => n.id === selectedNote.id);
      const current = latest?.content ?? selectedNote.content ?? "";
      const next = `${current}[[image:${path}]]`;
      handleFieldChange("content", next);

      // Pre-cache the signed URL so the image appears immediately.
      const { data } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path, 60 * 60);
      if (data?.signedUrl) {
        setSignedUrls((prev) => ({ ...prev, [path]: data.signedUrl }));
      }
      return true;
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (/bucket|not.*found|does not exist/i.test(msg)) {
        toast.error("Image storage isn't set up yet. Run the note-images migration in Supabase.");
      } else {
        toast.error(msg || "Failed to upload image");
      }
      return false;
    }
  };

  // Upload a batch sequentially so the marker appends stay in drop order and
  // the optimistic cache update from each one feeds the next.
  const uploadImageFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        await uploadImageFile(f);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    // reset so picking the same file twice still triggers onChange
    e.target.value = "";
    await uploadImageFiles(files);
  };

  // Filter out non-image drops (e.g. dragging a PDF in) so we don't even try
  // to upload them — keeps the error toast count down.
  const filesFromDataTransfer = (dt: DataTransfer): File[] => {
    const out: File[] = [];
    for (const f of Array.from(dt.files || [])) {
      if (f.type.startsWith("image/")) out.push(f);
    }
    return out;
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!selectedNote) return;
    // Only react to file drags, not text/element drags
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!selectedNote) return;
    if (!Array.from(e.dataTransfer.types || []).includes("Files")) return;
    // preventDefault is what actually permits a drop on this element
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!selectedNote) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    if (!selectedNote) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const files = filesFromDataTransfer(e.dataTransfer);
    if (files.length === 0) {
      toast.error("Drop an image file");
      return;
    }
    await uploadImageFiles(files);
  };

  // Pasting an image (e.g. screenshot from clipboard) — same upload path.
  const handlePaste = async (e: ClipboardEvent<HTMLDivElement>) => {
    if (!selectedNote) return;
    const items: DataTransferItem[] = e.clipboardData
      ? Array.from(e.clipboardData.items)
      : [];
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length === 0) return; // let the textarea handle text paste normally
    e.preventDefault();
    await uploadImageFiles(files);
  };

  const handleRemoveImage = async (path: string) => {
    if (!selectedNote) return;
    // strip the marker from content (+ any orphaned blank lines it leaves behind)
    const next = (selectedNote.content || "")
      .replace(new RegExp(`\\[\\[image:${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]\\n?`, "g"), "")
      .replace(/\n{3,}/g, "\n\n");
    handleFieldChange("content", next);
    // best-effort cleanup of the file
    supabase.storage.from(IMAGE_BUCKET).remove([path]).catch(() => {});
    setSignedUrls((prev) => {
      const { [path]: _, ...rest } = prev;
      return rest;
    });
  };

  const status = selectedNote ? saveStatuses[selectedNote.id] ?? "idle" : "idle";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Listing preview text — strip image markers so the sidebar doesn't show raw tokens.
  const previewText = (c: string) => {
    if (isDrawing(c || "")) return "Drawing canvas";
    const t = stripImages(c || "");
    if (t) return t.slice(0, 60);
    return extractImagePaths(c || "").length > 0 ? "Image attachment" : "Empty note";
  };

  // For drawing notes, image markers live in the tail after the JSON stroke
  // array; for text notes they're interleaved with the typed text. Either way
  // we render them as a flat list of image blocks.
  const blocks = selectedNote
    ? isDrawing(selectedNote.content || "")
      ? parseBlocks(drawingTail(selectedNote.content || ""))
      : parseBlocks(selectedNote.content || "")
    : [];
  const imageBlocks = blocks.filter((b): b is Extract<Block, { kind: "image" }> => b.kind === "image");

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-160px)]">
      {/* Sidebar – note list */}
      <div className="w-full md:w-72 shrink-0 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => createMutation.mutate("text")} disabled={createMutation.isPending} className="gap-1.5 w-full">
            <Plus className="h-4 w-4" /> Note
          </Button>
          <Button onClick={() => createMutation.mutate("drawing")} disabled={createMutation.isPending} variant="outline" className="gap-1.5 w-full">
            <Pencil className="h-4 w-4" /> Drawing
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {notes.length === 0 && (
            <p className="text-sm text-ink-muted text-center py-8">No notes yet</p>
          )}
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => setSelectedId(note.id)}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2.5 transition-colors group",
                selectedId === note.id
                  ? "bg-accent-light text-primary"
                  : "hover:bg-muted text-ink-secondary"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {isDrawing(note.content || "") ? (
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                  ) : (
                    <StickyNote className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                  )}
                  <p className="text-sm font-medium truncate">
                    {note.title || "Untitled Note"}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMutation.mutate(note.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs text-ink-muted truncate mt-0.5">
                {previewText(note.content || "")}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <Card
        className={cn(
          "flex-1 flex flex-col min-h-0 relative transition-colors",
          dragOver && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        {/* Drop overlay — only shown while a file is being dragged over the editor.
            pointer-events-none so it doesn't swallow the drop event from the Card. */}
        {dragOver && selectedNote && (
          <div className="absolute inset-2 z-10 rounded-lg border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-primary">
              <ImagePlus className="h-8 w-8" />
              <p className="text-sm font-medium">Drop image to attach</p>
            </div>
          </div>
        )}
        {selectedNote ? (
          <>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <Input
                value={selectedNote.title}
                onChange={(e) => handleFieldChange("title", e.target.value)}
                placeholder="Note title…"
                className="border-0 shadow-none text-lg font-semibold px-0 focus-visible:ring-0 min-w-0 flex-1"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFilePicked}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAttachClick}
                disabled={uploading}
                className="gap-1.5 text-ink-secondary shrink-0"
                title="Attach image"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                <span className="hidden sm:inline">{uploading ? "Uploading…" : "Image"}</span>
              </Button>
              <span className="text-xs text-ink-muted whitespace-nowrap flex items-center gap-1 shrink-0">
                {status === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>}
                {status === "saved" && <><Check className="h-3 w-3 text-primary" /> Saved</>}
              </span>
            </div>
            <CardContent className="flex-1 p-0 min-h-0">
              {isDrawing(selectedNote.content || "") ? (
                <div className="h-full w-full overflow-y-auto flex flex-col">
                  {imageBlocks.length > 0 && (
                    <div className="space-y-3 p-5 pb-3">
                      {imageBlocks.map((b) => (
                        <div key={b.path} className="relative group rounded-lg overflow-hidden border border-border bg-muted/30">
                          {signedUrls[b.path] ? (
                            <img
                              src={signedUrls[b.path]}
                              alt="Note attachment"
                              className="w-full max-h-[480px] object-contain bg-background"
                            />
                          ) : (
                            <div className="flex items-center justify-center py-12 text-ink-muted text-sm">
                              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading image…
                            </div>
                          )}
                          <button
                            onClick={() => handleRemoveImage(b.path)}
                            className="absolute top-2 right-2 rounded-full bg-background/90 backdrop-blur p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-background"
                            title="Remove image"
                          >
                            <X className="h-3.5 w-3.5 text-ink-secondary" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex-1 min-h-[400px]">
                    <DrawingCanvas
                      value={parseDrawing(selectedNote.content || "")}
                      onChange={(strokes) =>
                        handleFieldChange(
                          "content",
                          serializeDrawing(strokes, drawingTail(selectedNote.content || "")),
                        )
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full w-full overflow-y-auto p-5 space-y-4">
                  <Textarea
                    value={textOnly}
                    onChange={(e) => handleTextChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        const ta = e.currentTarget;
                        const start = ta.selectionStart;
                        const end = ta.selectionEnd;
                        const next = textOnly.slice(0, start) + "\t" + textOnly.slice(end);
                        handleTextChange(next);
                        requestAnimationFrame(() => {
                          ta.selectionStart = ta.selectionEnd = start + 1;
                        });
                      }
                    }}
                    placeholder="Start typing your note…"
                    className="min-h-[160px] w-full resize-y border-0 shadow-none focus-visible:ring-0 p-0 text-sm leading-relaxed bg-transparent whitespace-pre-wrap"
                  />
                  {imageBlocks.length > 0 && (
                    <div className="space-y-3 pt-2">
                      {imageBlocks.map((b) => (
                        <div key={b.path} className="relative group rounded-lg overflow-hidden border border-border bg-muted/30">
                          {signedUrls[b.path] ? (
                            <img
                              src={signedUrls[b.path]}
                              alt="Note attachment"
                              className="w-full max-h-[480px] object-contain bg-background"
                            />
                          ) : (
                            <div className="flex items-center justify-center py-12 text-ink-muted text-sm">
                              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading image…
                            </div>
                          )}
                          <button
                            onClick={() => handleRemoveImage(b.path)}
                            className="absolute top-2 right-2 rounded-full bg-background/90 backdrop-blur p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-background"
                            title="Remove image"
                          >
                            <X className="h-3.5 w-3.5 text-ink-secondary" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={StickyNote}
              title="Select or create a note"
              description="Your private notes are only visible to you."
              actionLabel="New Note"
              onAction={() => createMutation.mutate("text")}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
