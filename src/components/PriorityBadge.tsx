import { cn } from "@/lib/utils";

const config: Record<string, string> = {
  high: "bg-destructive-light text-destructive",
  medium: "bg-warning-light text-warning",
  low: "bg-success-light text-success",
};

export default function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn("inline-flex rounded-pill px-2.5 py-0.5 text-xs font-medium capitalize", config[priority] ?? config.medium)}>
      {priority}
    </span>
  );
}
