// Shown for the split second a page's code is still loading — same shape as a page,
// so nothing jumps when the real page appears.
export default function PageSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-2 h-7 w-40 rounded-lg bg-muted" />
      <div className="mb-6 h-4 w-24 rounded bg-muted/70" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}
