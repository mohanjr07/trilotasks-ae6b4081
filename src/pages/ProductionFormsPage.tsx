import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileSpreadsheet, FileText, Plus, Trash2, FolderOpen, Loader2, History } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { toast } from "sonner";
import type { FieldLocator } from "@/lib/productionForms";
import { formatRefNumber } from "@/lib/productionForms";
import ProductionFormUploadDialog from "@/components/ProductionFormUploadDialog";
import ProductionFormEditDialog from "@/components/ProductionFormEditDialog";
import ProductionFormLogDialog from "@/components/ProductionFormLogDialog";

export type ProductionForm = {
  id: string;
  title: string;
  description: string | null;
  file_type: "word" | "excel";
  storage_path: string;
  original_filename: string;
  field_locator: FieldLocator;
  ref_prefix: string;
  ref_padding: number;
  current_number: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export default function ProductionFormsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<ProductionForm | null>(null);
  const [deletingForm, setDeletingForm] = useState<ProductionForm | null>(null);

  const { data: forms = [], isLoading } = useQuery({
    queryKey: ["production_forms"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_forms")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ProductionForm[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (form: ProductionForm) => {
      await supabase.storage.from("production-forms").remove([form.storage_path]);
      const { error } = await supabase.from("production_forms").delete().eq("id", form.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Form deleted");
      queryClient.invalidateQueries({ queryKey: ["production_forms"] });
      setDeletingForm(null);
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to delete form"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-semibold text-ink-primary">Forms and Formats</h2>
          <p className="text-sm text-ink-muted mt-0.5">
            Word and Excel templates with an auto-incrementing reference number — it bumps up every time someone opens the form.
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setLogOpen(true)} className="gap-2">
              <History className="h-4 w-4" /> View Log
            </Button>
            <Button onClick={() => setUploadOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Upload Form
            </Button>
          </div>
        )}
      </div>

      {forms.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No forms yet"
          description={
            isAdmin
              ? "Upload a Word or Excel template and mark which field holds the running reference number."
              : "Your admin hasn't uploaded any forms yet."
          }
          actionLabel={isAdmin ? "Upload Form" : undefined}
          onAction={isAdmin ? () => setUploadOpen(true) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.map((form) => (
            <Card key={form.id} className="flex flex-col">
              <CardContent className="p-5 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {form.file_type === "word" ? (
                      <FileText className="h-5 w-5 text-blue-600 shrink-0" />
                    ) : (
                      <FileSpreadsheet className="h-5 w-5 text-green-600 shrink-0" />
                    )}
                    <p className="font-medium text-ink-primary truncate">{form.title}</p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => setDeletingForm(form)}
                      className="text-ink-muted hover:text-destructive transition-colors shrink-0"
                      title="Delete form"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {form.description && (
                  <p className="text-xs text-ink-muted line-clamp-2">{form.description}</p>
                )}

                <div className="flex items-center gap-2 mt-auto pt-2">
                  <Badge variant="secondary" className="font-mono">
                    Next: {formatRefNumber(form.ref_prefix, form.ref_padding, form.current_number + 1)}
                  </Badge>
                  <Badge variant="outline" className="capitalize">{form.file_type}</Badge>
                </div>

                <Button onClick={() => setEditingForm(form)} className="gap-2 w-full mt-1">
                  <FolderOpen className="h-4 w-4" /> Open
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProductionFormUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ["production_forms"] })}
      />

      {isAdmin && <ProductionFormLogDialog open={logOpen} onClose={() => setLogOpen(false)} />}

      {editingForm && (
        <ProductionFormEditDialog
          form={editingForm}
          onClose={() => setEditingForm(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["production_forms"] })}
        />
      )}

      <AlertDialog open={!!deletingForm} onOpenChange={(open) => !open && setDeletingForm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingForm?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the uploaded file and its reference number history. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingForm && deleteMutation.mutate(deletingForm)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
