// ─────────────────────────────────────────────────────────────────────────────
//  Free self-update for the Android app (no Play Store needed).
//  The app shell reports its build number in the user agent ("TaskFlowApp/3").
//  /app-version.json on the website says which build is the latest and where the
//  APK is. When a newer build is published, the app shows an "Update available"
//  pop-up; tapping Update downloads the new APK and Android asks to install it.
//  (Website/iPhone/desktop users never see this — their updates are automatic.)
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isNativeApp, PUBLIC_SITE } from "@/lib/platform";
import { openExternal } from "@/lib/nativeFiles";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Latest = { versionCode: number; versionName: string; apk: string; notes?: string; force?: boolean };

const installedBuild = () => Number(/TaskFlowApp\/(\d+)/.exec(navigator.userAgent)?.[1] ?? 1);
const SNOOZE_KEY = "taskflow-app-update-snooze";

async function fetchLatest(): Promise<Latest | null> {
  try {
    const res = await fetch(`${PUBLIC_SITE}/app-version.json?v=${Date.now()}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Latest) : null;
  } catch {
    return null;
  }
}

export default function NativeAppUpdate() {
  const [latest, setLatest] = useState<Latest | null>(null);
  const isAndroid = isNativeApp && /android/i.test(navigator.userAgent);

  useEffect(() => {
    if (!isAndroid) return;
    const check = async () => {
      const l = await fetchLatest();
      if (!l || !(l.versionCode > installedBuild())) return;
      let snoozed = false;
      // "Later" hides the prompt for 6 hours (a forced update always shows)
      try {
        const [v, at] = (localStorage.getItem(SNOOZE_KEY) ?? "").split("@");
        snoozed = !l.force && v === String(l.versionCode) && Date.now() - Number(at) < 6 * 3600 * 1000;
      } catch { /* ignore */ }
      if (!snoozed) setLatest(l);
    };
    check();
    const id = window.setInterval(check, 30 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [isAndroid]);

  if (!latest) return null;
  const apkUrl = latest.apk.startsWith("http") ? latest.apk : `${PUBLIC_SITE}${latest.apk}?v=${latest.versionCode}`;
  const later = () => {
    try { localStorage.setItem(SNOOZE_KEY, `${latest.versionCode}@${Date.now()}`); } catch { /* ignore */ }
    setLatest(null);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !latest.force) later(); }}>
      <DialogContent className="max-w-sm" onInteractOutside={(e) => latest.force && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Update available</DialogTitle>
          <DialogDescription>
            TaskFlow {latest.versionName} is ready.{latest.notes ? ` ${latest.notes}` : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-ink-muted">
          Tap Update — the new app downloads, then tap <b>Install</b> when Android asks. Your data and login stay as they are.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          {!latest.force && <Button variant="outline" onClick={later}>Later</Button>}
          <Button className="gap-1.5" onClick={() => openExternal(apkUrl).catch(() => { window.location.href = apkUrl; })}>
            <Download className="h-4 w-4" /> Update
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
