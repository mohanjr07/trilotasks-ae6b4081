import { cn } from "@/lib/utils";
import { useTaskColumns } from "@/hooks/useTaskColumns";

const statusConfig: Record<string, { dot: string; bg: string; text: string }> = {
  todo: { dot: "bg-ink-muted", bg: "bg-muted", text: "text-ink-secondary" },
  in_progress: { dot: "bg-primary", bg: "bg-accent-light", text: "text-primary" },
  on_hold: { dot: "bg-warning", bg: "bg-warning-light", text: "text-warning" },
  completed: { dot: "bg-success", bg: "bg-success-light", text: "text-success" },
  pending: { dot: "bg-warning", bg: "bg-warning-light", text: "text-warning" },
  approved: { dot: "bg-success", bg: "bg-success-light", text: "text-success" },
  rejected: { dot: "bg-destructive", bg: "bg-destructive-light", text: "text-destructive" },
  reverted: { dot: "bg-ink-muted", bg: "bg-muted", text: "text-ink-muted" },
};

const labels: Record<string, string> = {
  todo: "To Do", in_progress: "In Progress", on_hold: "On Hold",
  completed: "Completed", pending: "Pending", approved: "Approved", rejected: "Rejected",
  reverted: "Reverted",
};

export default function StatusBadge({ status }: { status: string }) {
  // Task-board columns can be renamed by an admin or added as custom entries.
  // We look them up via the shared hook and overlay custom label / color when
  // appropriate. Non-board statuses (pending/approved/rejected/reverted for
  // leave requests) are unaffected because they never appear in task_columns.
  const { data: columns = [] } = useTaskColumns();
  const custom = columns.find((c) => c.key === status);

  const builtin = statusConfig[status];
  const config = builtin ?? statusConfig.todo;

  // Prefer an admin-renamed label; otherwise use the hardcoded label; otherwise
  // prettify the key (handles brand-new custom columns like "in_review").
  const label =
    custom?.label ??
    labels[status] ??
    status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Use an inline custom color when the status isn't a built-in (i.e. it's a
  // custom admin-added column). Built-ins keep their themed Tailwind classes.
  const useCustomColor = !!custom && !builtin;
  const dotStyle = useCustomColor ? { backgroundColor: custom!.color } : undefined;
  const pillStyle = useCustomColor
    ? { backgroundColor: `${custom!.color}1a`, color: custom!.color }
    : undefined;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-medium",
        !useCustomColor && config.bg,
        !useCustomColor && config.text,
      )}
      style={pillStyle}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", !useCustomColor && config.dot)}
        style={dotStyle}
      />
      {label}
    </span>
  );
}
