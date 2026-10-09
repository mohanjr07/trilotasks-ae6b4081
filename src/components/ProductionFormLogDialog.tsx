import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, History, Trash2 } from "lucide-react";
import EmptyState from "@/components/EmptyState";

type Props = {
  open: boolean;
  onClose: () => void;
};

type LogRow = {
  id: string;
  form_id: string;
  reference_value: string;
  opened_at: string;
  profiles: { full_name: string } | null;
  production_forms: { title: string } | null;
};

export default function ProductionFormLogDialog({ open, onClose }: Props) {
  const [formFilter, setFormFilter] = useState<string>("all");
  const qc = useQueryClient();
  const { profile } = useAuth();
  const canDelete = profile?.role === "admin" || profile?.role === "super_admin";
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("delete_form_log", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_form_opens_log"] });
      qc.invalidateQueries({ queryKey: ["production-forms"] }); qc.invalidateQueries({ queryKey: ["production_forms"] });
      qc.invalidateQueries({ queryKey: ["form-requests"] });
      toast.success("Entry deleted — the running number has been updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't delete"),
  });
  const confirmDel = (row: { id: string; reference_value: string }) => {
    if (window.confirm(`Delete ${row.reference_value}? Any form request with this number is deleted too. If it is the latest number, it will be used again for the next form.`)) del.mutate(row.id);
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["production_form_opens_log"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_form_opens")
        .select("id, form_id, reference_value, opened_at, profiles(full_name), production_forms(title)")
        .order("opened_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as LogRow[];
    },
  });

  const { data: forms = [] } = useQuery({
    queryKey: ["production_forms_log_filter"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_forms")
        .select("id, title")
        .order("title");
      if (error) throw error;
      return data as { id: string; title: string }[];
    },
  });

  const filtered = useMemo(
    () => (formFilter === "all" ? rows : rows.filter((r) => r.form_id === formFilter)),
    [rows, formFilter]
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Reference Number Log</DialogTitle>
          <DialogDescription>
            Every time someone clicks "Use This" on a form, the assigned reference number, who used it, and which
            form is recorded here. Admins only.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0">
          <Select value={formFilter} onValueChange={setFormFilter}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue placeholder="All forms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All forms ({rows.length})</SelectItem>
              {forms.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.title} ({rows.filter((r) => r.form_id === f.id).length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={History}
              title="No usage yet"
              description={
                formFilter === "all"
                  ? 'Once someone clicks "Use This" on a form, it will show up here.'
                  : "No reference numbers have been issued for this form yet."
              }
            />
          ) : (
            <>
            <ul className="md:hidden divide-y divide-border">
              {filtered.map((row) => (
                <li key={row.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary" className="font-mono">{row.reference_value}</Badge>
                    <span className="text-[11px] text-ink-muted">{new Date(row.opened_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-primary truncate">{row.production_forms?.title ?? "—"}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-ink-muted truncate">{row.profiles?.full_name ?? "Unknown"}</p>
                    {canDelete && (
                      <button onClick={() => confirmDel(row)} disabled={del.isPending} className="rounded p-1 text-ink-muted hover:text-destructive" aria-label="Delete entry">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <table className="hidden md:table w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Reference No.</th>
                  <th className="py-2 pr-3 font-medium">Form</th>
                  <th className="py-2 pr-3 font-medium">Used By</th>
                  <th className="py-2 pr-3 font-medium">When</th>
                  {canDelete && <th className="py-2 font-medium" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <Badge variant="secondary" className="font-mono">
                        {row.reference_value}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 truncate max-w-[180px]">{row.production_forms?.title ?? "—"}</td>
                    <td className="py-2 pr-3 truncate max-w-[160px]">{row.profiles?.full_name ?? "Unknown"}</td>
                    <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">
                      {new Date(row.opened_at).toLocaleString()}
                    </td>
                    {canDelete && (
                      <td className="py-2 text-right">
                        <button onClick={() => confirmDel(row)} disabled={del.isPending} title="Delete entry"
                          className="rounded p-1.5 text-ink-muted hover:text-destructive hover:bg-destructive/10" aria-label="Delete entry">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
