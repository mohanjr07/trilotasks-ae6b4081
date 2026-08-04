import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, History } from "lucide-react";
import EmptyState from "@/components/EmptyState";

type Props = {
  open: boolean;
  onClose: () => void;
};

type LogRow = {
  id: string;
  reference_value: string;
  opened_at: string;
  profiles: { full_name: string } | null;
  production_forms: { title: string } | null;
};

export default function ProductionFormLogDialog({ open, onClose }: Props) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["production_form_opens_log"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_form_opens")
        .select("id, reference_value, opened_at, profiles(full_name), production_forms(title)")
        .order("opened_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as LogRow[];
    },
  });

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

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={History}
              title="No usage yet"
              description={'Once someone clicks "Use This" on a form, it will show up here.'}
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Reference No.</th>
                  <th className="py-2 pr-3 font-medium">Form</th>
                  <th className="py-2 pr-3 font-medium">Used By</th>
                  <th className="py-2 pr-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
