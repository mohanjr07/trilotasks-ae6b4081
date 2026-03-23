import { cn } from "@/lib/utils";

const statusConfig: Record<string, { dot: string; bg: string; text: string }> = {
  todo: { dot: "bg-ink-muted", bg: "bg-muted", text: "text-ink-secondary" },
  in_progress: { dot: "bg-primary", bg: "bg-accent-light", text: "text-primary" },
  on_hold: { dot: "bg-warning", bg: "bg-warning-light", text: "text-warning" },
  completed: { dot: "bg-success", bg: "bg-success-light", text: "text-success" },
  pending: { dot: "bg-warning", bg: "bg-warning-light", text: "text-warning" },
  approved: { dot: "bg-success", bg: "bg-success-light", text: "text-success" },
  rejected: { dot: "bg-destructive", bg: "bg-destructive-light", text: "text-destructive" },
};

const labels: Record<string, string> = {
  todo: "To Do", in_progress: "In Progress", on_hold: "On Hold",
  completed: "Completed", pending: "Pending", approved: "Approved", rejected: "Rejected",
};

export default function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? statusConfig.todo;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-medium", config.bg, config.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {labels[status] ?? status}
    </span>
  );
}
