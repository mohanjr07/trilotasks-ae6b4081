// Phone-only tab switcher: every option is visible at once (wraps into rows),
// so nothing ever scrolls sideways. Pages keep their normal tabs on tablet/desktop.
import { cn } from "@/lib/utils";

export type Segment<T extends string> = { key: T; label: string; count?: number };

export default function MobileSegments<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: Segment<T>[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  const n = items.length;
  const cols = n <= 4 ? n : n === 5 || n === 6 ? 3 : 4;
  return (
    <div
      className={cn("md:hidden grid gap-1.5 rounded-xl bg-muted/60 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      role="tablist"
    >
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={cn(
              "flex items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[13px] font-medium leading-tight transition-colors min-w-0",
              active ? "bg-card text-primary shadow-sm" : "text-ink-secondary active:bg-card/60"
            )}
          >
            <span className="truncate">{it.label}</span>
            {typeof it.count === "number" && it.count > 0 && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 text-[10px] font-semibold leading-4",
                  active ? "bg-primary text-primary-foreground" : "bg-ink-muted/20 text-ink-secondary"
                )}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
