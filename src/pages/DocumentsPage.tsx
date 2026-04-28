import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO } from "date-fns";
import {
  FileText, Search, Upload, Download, Trash2, X, Plus, Folder,
  FileImage, FileVideo, File as FileIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import UserAvatar from "@/components/UserAvatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BUCKET = "user-documents";

type UserDoc = {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

const CATEGORIES = ["Offer Letter", "Payslip", "ID Proof", "Certificate", "Contract", "Other"];

function formatBytes(b?: number | null) {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 102.4) / 10} KB`;
  return `${Math.round(b / (1024 * 102.4)) / 10} MB`;
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  try { return format(parseISO(d), "MMM d, yyyy"); } catch { return d; }
}

function fileIcon(mime?: string | null) {
  if (!mime) return FileIcon;
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime === "application/pdf") return FileText;
  return FileIcon;
}

export default function DocumentsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === "admin";

  const [searchParams, setSearchParams] = useSearchParams();
  const urlUserId = searchParams.get("user");

  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>(urlUserId ?? profile?.id ?? "");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string>(CATEGORIES[0]);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const targetUserId = isAdmin ? selectedUserId : profile?.id ?? "";

  const { data: people = [] } = useQuery({
    queryKey: ["docs-people"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, avatar_url, role")
        .order("full_name");
      return data ?? [];
    },
    enabled: isAdmin,
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["user-documents", targetUserId],
    queryFn: async () => {
      if (!targetUserId) return [] as UserDoc[];
      const { data, error } = await supabase
        .from("user_documents")
        .select("*")
        .eq("user_id", targetUserId)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as UserDoc[];
    },
    enabled: !!targetUserId,
  });

  const filteredPeople = useMemo(() => {
    const q = search.toLowerCase();
    return people.filter((p: any) =>
      !q || p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
    );
  }, [people, search]);

  const selectedPerson = useMemo(
    () => people.find((p: any) => p.id === targetUserId),
    [people, targetUserId]
  );

  const filteredDocs = useMemo(() => {
    return documents.filter(d =>
      categoryFilter === "all" || (d.category ?? "Other") === categoryFilter
    );
  }, [documents, categoryFilter]);

  const handleUpload = async () => {
    if (!uploadFile) { toast.error("Choose a file"); return; }
    if (!targetUserId) { toast.error("Select a user first"); return; }
    setUploading(true);
    try {
      const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${targetUserId}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, uploadFile, {
          contentType: uploadFile.type || undefined,
          upsert: false,
        });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("user_documents").insert({
        user_id: targetUserId,
        name: uploadName.trim() || uploadFile.name,
        category: uploadCategory || null,
        file_path: path,
        file_size: uploadFile.size,
        mime_type: uploadFile.type || null,
        uploaded_by: profile?.id,
      });
      if (insErr) {
        // Clean up the orphaned object if metadata insert failed
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        throw insErr;
      }

      toast.success("Uploaded");
      queryClient.invalidateQueries({ queryKey: ["user-documents", targetUserId] });
      setUploadOpen(false);
      setUploadFile(null);
      setUploadName("");
      setUploadCategory(CATEGORIES[0]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      toast.error("Upload failed: " + (e?.message ?? ""));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: UserDoc) => {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.file_path, 60);
      if (error) throw error;
      // Force download in a new tab
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e: any) {
      toast.error("Download failed: " + (e?.message ?? ""));
    }
  };

  const handleView = async (doc: UserDoc) => {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.file_path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error("Could not open file: " + (e?.message ?? ""));
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (doc: UserDoc) => {
      // Remove storage object first, then metadata. If storage fails we don't
      // delete the row so it stays visible to retry.
      const { error: stErr } = await supabase.storage.from(BUCKET).remove([doc.file_path]);
      if (stErr && stErr.message && !stErr.message.includes("not found")) throw stErr;
      const { error } = await supabase.from("user_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-documents", targetUserId] });
      toast.success("Deleted");
      setDeleteId(null);
    },
    onError: (e: any) => toast.error("Delete failed: " + (e?.message ?? "")),
  });

  // When admin changes user, sync to URL
  const onPickUser = (id: string) => {
    setSelectedUserId(id);
    setSearchParams(id ? { user: id } : {}, { replace: true });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-ink-primary">Documents</h2>
          <p className="text-sm text-ink-muted mt-0.5">
            {isAdmin
              ? "Upload and manage documents for any user."
              : "Documents shared with you by your admin."}
          </p>
        </div>
        {isAdmin && targetUserId && (
          <Button onClick={() => setUploadOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> Upload
          </Button>
        )}
      </div>

      {/* Admin person picker */}
      {isAdmin && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
              <Input
                placeholder="Search a person…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedUserId} onValueChange={onPickUser}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Select a person" /></SelectTrigger>
              <SelectContent>
                {filteredPeople.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedPerson && (
              <div className="flex items-center gap-2">
                <UserAvatar name={selectedPerson.full_name} avatarUrl={selectedPerson.avatar_url} size="sm" />
                <div>
                  <p className="text-sm font-medium text-ink-primary">{selectedPerson.full_name}</p>
                  <p className="text-xs text-ink-muted capitalize">{selectedPerson.role?.replace("_", " ")}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Body */}
      {!targetUserId ? (
        <div className="rounded-xl border border-border bg-card flex flex-col items-center justify-center py-16 text-center">
          <Folder className="h-10 w-10 text-ink-muted mb-3" />
          <h3 className="text-base font-semibold text-ink-primary">Select a person</h3>
          <p className="text-sm text-ink-muted">Pick someone above to view or upload documents.</p>
        </div>
      ) : isLoading ? (
        <div className="rounded-xl border border-border bg-card flex items-center justify-center py-16 text-ink-muted text-sm">
          Loading documents…
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="rounded-xl border border-border bg-card flex flex-col items-center justify-center py-16 text-center">
          <FileText className="h-10 w-10 text-ink-muted mb-3" />
          <h3 className="text-base font-semibold text-ink-primary">No documents yet</h3>
          <p className="text-sm text-ink-muted">
            {isAdmin ? "Upload the first document for this user." : "Your admin hasn't shared any documents yet."}
          </p>
          {isAdmin && (
            <Button onClick={() => setUploadOpen(true)} className="mt-4 gap-2">
              <Upload className="h-4 w-4" /> Upload
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-ink-muted text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3 font-medium">Document</th>
                <th className="text-left px-5 py-3 font-medium">Category</th>
                <th className="text-left px-5 py-3 font-medium">Size</th>
                <th className="text-left px-5 py-3 font-medium">Uploaded</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredDocs.map((doc) => {
                const Icon = fileIcon(doc.mime_type);
                return (
                  <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-ink-primary truncate">{doc.name}</p>
                          <p className="text-xs text-ink-muted truncate">{doc.mime_type ?? "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-muted text-ink-secondary">
                        {doc.category ?? "Other"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-ink-muted text-xs tabular-nums">
                      {formatBytes(doc.file_size)}
                    </td>
                    <td className="px-5 py-3.5 text-ink-secondary text-xs">
                      {formatDate(doc.uploaded_at)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleView(doc)}
                          className="p-1.5 rounded-lg hover:bg-muted text-ink-muted hover:text-ink-primary"
                          title="View"
                        >
                          <FileIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDownload(doc)}
                          className="p-1.5 rounded-lg hover:bg-muted text-ink-muted hover:text-ink-primary"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => setDeleteId(doc.id)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-ink-muted hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload modal (admin) */}
      <AnimatePresence>
        {uploadOpen && isAdmin && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={() => !uploading && setUploadOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-ink-primary">Upload Document</h3>
                  <button disabled={uploading} onClick={() => setUploadOpen(false)} className="text-ink-muted hover:text-ink-primary disabled:opacity-50">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {selectedPerson && (
                  <p className="text-xs text-ink-muted">
                    For <span className="text-ink-primary font-medium">{selectedPerson.full_name}</span>
                  </p>
                )}
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">File *</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setUploadFile(f);
                        if (f && !uploadName.trim()) setUploadName(f.name);
                      }}
                      className="w-full text-sm rounded-md border border-border bg-background px-3 py-2 file:mr-3 file:rounded file:border-0 file:bg-primary file:text-primary-foreground file:px-3 file:py-1 file:text-xs"
                    />
                    {uploadFile && (
                      <p className="text-xs text-ink-muted mt-1">{formatBytes(uploadFile.size)} · {uploadFile.type || "unknown"}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Display name</label>
                    <Input
                      placeholder="e.g. Offer Letter — March 2026"
                      value={uploadName}
                      onChange={(e) => setUploadName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Category</label>
                    <Select value={uploadCategory} onValueChange={setUploadCategory}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
                  <Button className="flex-1 gap-2" onClick={handleUpload} disabled={uploading || !uploadFile}>
                    {uploading ? "Uploading…" : (<><Plus className="h-4 w-4" /> Upload</>)}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteId && isAdmin && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/40 z-40" onClick={() => setDeleteId(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
                <h3 className="text-lg font-semibold text-ink-primary">Delete Document?</h3>
                <p className="text-sm text-ink-muted">The file will be removed for this user. This cannot be undone.</p>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => {
                      const doc = documents.find(d => d.id === deleteId);
                      if (doc) deleteMutation.mutate(doc);
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
