// "Update available" card — shown in the notification bell, Notifications page,
// Settings and Profile while a newer Android app build is waiting.
import { Download, CheckCircle2, Smartphone, X } from "lucide-react";
import { dismissAppUpdate, openAppUpdate, updateVisible, useAppUpdate } from "@/lib/appUpdate";
import { cn } from "@/lib/utils";

const APP_NAME = "TaskFlow";

export default function AppUpdateBanner({ compact = false, showUpToDate = false, className }: {
  compact?: boolean; showUpToDate?: boolean; className?: string;
}) {
  const st = useAppUpdate();
  const { latest, installed, isAndroidApp } = st;
  // closed with ✕ → only Settings → App updates (showUpToDate) still shows it
  if (latest && !showUpToDate && !updateVisible(st)) return null;

  if (!latest) {
    if (!showUpToDate) return null;
    return (
      <div className={cn("flex items-start gap-3 rounded-xl border border-border bg-card p-4", className)}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success-light text-success">
          {isAndroidApp ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-primary">{isAndroidApp ? "You're up to date" : "Updates are automatic"}</p>
          <p className="text-xs text-ink-muted">
            {isAndroidApp
              ? `${APP_NAME} app build ${installed}. You'll be told here when a new version is ready.`
              : `The website always loads the latest version of ${APP_NAME}. App updates show here inside the Android app.`}
          </p>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("flex w-full items-center border-l-2 border-l-primary bg-accent-light/40", className)}>
      <button type="button" onClick={openAppUpdate}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Download className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-primary">Update available · {latest.versionName}</span>
          <span className="block truncate text-xs text-ink-muted">{latest.notes || `A new version of ${APP_NAME} is ready`} — tap to update</span>
        </span>
      </button>
      <button type="button" onClick={dismissAppUpdate} aria-label="Close" title="Close (still in Settings → App updates)"
        className="mr-2 rounded-full p-1.5 text-ink-muted hover:bg-muted hover:text-ink-primary"><X className="h-4 w-4" /></button>
      </div>
    );
  }

  return (
    <div className={cn("relative flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-accent-light/40 p-4", !showUpToDate && "pr-10", className)}>
      {!showUpToDate && (
        <button type="button" onClick={dismissAppUpdate} aria-label="Close" title="Close (still in Settings → App updates)"
          className="absolute right-2 top-2 rounded-full p-1.5 text-ink-muted hover:bg-muted hover:text-ink-primary"><X className="h-4 w-4" /></button>
      )}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Download className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-primary">Update available — {APP_NAME} {latest.versionName}</p>
        <p className="text-xs text-ink-muted">{latest.notes || "A new version of the app is ready."} Your data and login stay as they are.</p>
      </div>
      <button type="button" onClick={openAppUpdate}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm active:scale-95 transition-transform max-sm:w-full max-sm:justify-center">
        <Download className="h-4 w-4" /> Update now
      </button>
    </div>
  );
}
