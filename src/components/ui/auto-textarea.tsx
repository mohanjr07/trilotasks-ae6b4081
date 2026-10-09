import * as React from "react";
import { cn } from "@/lib/utils";

/** A text box that looks like a one-line input but wraps long text onto the next line and grows with it. */
const AutoTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minHeight?: number }>(
  ({ className, minHeight = 36, onChange, value, ...props }, ref) => {
    const inner = React.useRef<HTMLTextAreaElement | null>(null);
    const fit = () => {
      const el = inner.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.max(minHeight, el.scrollHeight + 2)}px`;
    };
    React.useLayoutEffect(fit, [value]);
    return (
      <textarea
        ref={(el) => { inner.current = el; if (typeof ref === "function") ref(el); else if (ref) ref.current = el; }}
        rows={1}
        value={value}
        onChange={(e) => { onChange?.(e); fit(); }}
        className={cn(
          "flex w-full resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
AutoTextarea.displayName = "AutoTextarea";
export { AutoTextarea };
