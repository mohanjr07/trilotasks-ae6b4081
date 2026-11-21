// Shows a message instead of a blank white screen when a page crashes,
// and reloads once by itself when a new version was published and an old
// page file is no longer on the server ("Failed to fetch dynamically imported module").
import { Component, type ReactNode } from "react";

const isChunkError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk|preload/i.test(String((e as any)?.message ?? e));

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem("tf-chunk-reload") || 0);
    if (Date.now() - last < 30_000) return false;          // don't loop
    sessionStorage.setItem("tf-chunk-reload", String(Date.now()));
  } catch { /* storage blocked */ }
  window.location.reload();
  return true;
}

// a page file from the previous version failed to load → reload to get the new one
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (ev) => { ev.preventDefault(); reloadOnce(); });
}

type State = { error: Error | null };

export default class ErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[TaskFlow] page crashed:", error);
    if (isChunkError(error)) reloadOnce();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={this.props.inline ? "py-16" : "flex min-h-screen items-center justify-center bg-background p-6"}>
        <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="font-heading text-lg font-semibold text-ink-primary">Something went wrong on this page</p>
          <p className="mt-2 text-sm text-ink-muted">Reload to try again. If it keeps happening, send a screenshot of this message.</p>
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-left text-[11px] text-ink-secondary">{String(error?.message ?? error)}</pre>
          <button onClick={() => window.location.reload()}
            className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
