import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, StickyNote, Check, Loader2 } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Note = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type SaveStatus = "idle" | "saving" | "saved";

export default function NotesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("user_notes")
        .insert({ user_id: user!.id, title: "Untitled Note", content: "" })
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

  const handleFieldChange = (field: "title" | "content", value: string) => {
    if (!selectedNote) return;
    // Optimistically update the cache so the UI is instant
    queryClient.setQueryData<Note[]>(["user_notes"], (old) =>
      (old ?? []).map((n) => (n.id === selectedNote.id ? { ...n, [field]: value } : n))
    );
    const updated = { ...selectedNote, [field]: value };
    debouncedSave(updated.id, updated.title, updated.content);
  };

  const status = selectedNote ? saveStatuses[selectedNote.id] ?? "idle" : "idle";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-160px)]">
      {/* Sidebar – note list */}
      <div className="w-full md:w-72 shrink-0 flex flex-col gap-2">
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="gap-2 w-full">
          <Plus className="h-4 w-4" /> New Note
        </Button>

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
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium truncate flex-1">
                  {note.title || "Untitled Note"}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMutation.mutate(note.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-destructive transition-all ml-2"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs text-ink-muted truncate mt-0.5">
                {note.content?.slice(0, 60) || "Empty note"}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <Card className="flex-1 flex flex-col min-h-0">
        {selectedNote ? (
          <>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <Input
                value={selectedNote.title}
                onChange={(e) => handleFieldChange("title", e.target.value)}
                placeholder="Note title…"
                className="border-0 shadow-none text-lg font-semibold px-0 focus-visible:ring-0"
              />
              <span className="text-xs text-ink-muted whitespace-nowrap flex items-center gap-1">
                {status === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>}
                {status === "saved" && <><Check className="h-3 w-3 text-primary" /> Saved</>}
              </span>
            </div>
            <CardContent className="flex-1 p-0 min-h-0">
              <Textarea
                value={selectedNote.content}
                onChange={(e) => handleFieldChange("content", e.target.value)}
                placeholder="Start typing your note…"
                className="h-full w-full resize-none border-0 shadow-none rounded-none focus-visible:ring-0 p-5 text-sm leading-relaxed"
              />
            </CardContent>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={StickyNote}
              title="Select or create a note"
              description="Your private notes are only visible to you."
              actionLabel="New Note"
              onAction={() => createMutation.mutate()}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
