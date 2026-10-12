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
  const [started, setStarted] = useState(false);
  const [pct, setPct] = useState<number | null>(null);      // in-app download progress
  const [err, setErr] = useState("");
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
  // The app's own web view can't download files, and the in-app browser tab often
  // stalls on a 20 MB APK. A link to a *different* address than the app's makes
  // Android open it in the phone's real browser (Chrome), which downloads it with
  // a notification and hands it to the installer. The plain-http form of our own
  // address counts as different; the site immediately redirects it to https.
  const externalUrl = apkUrl.startsWith(PUBLIC_SITE) ? apkUrl.replace(/^https:/, "http:") : apkUrl;
  const updater = (window as any).Capacitor?.Plugins?.AppUpdater;   // built into app 1.2.0+
  const viaChrome = () => { setStarted(true); window.location.href = externalUrl; };
  const startUpdate = async () => {
    if (!updater) return viaChrome();
    // download inside the app, then Android's "Update this app?" screen opens by itself
    setErr(""); setPct(0);
    const sub = await updater.addListener("progress", (e: { percent: number }) => setPct(e.percent));
    try {
      await updater.update({ url: apkUrl });
      setPct(100);
    } catch (e: any) {
      setPct(null);
      setErr(String(e?.message ?? e));
    } finally {
      sub?.remove?.();
    }
  };
  const tryInApp = () => { openExternal(apkUrl).catch(() => { window.location.href = apkUrl; }); };
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
        {updater && (pct !== null || err) ? (
          <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs text-ink-secondary">
            {err ? (
              <>
                <p className="font-semibold text-destructive">{err}</p>
                <p>
                  <button type="button" onClick={startUpdate} className="font-medium text-primary underline">Try again</button>
                  {" · "}
                  <button type="button" onClick={viaChrome} className="font-medium text-primary underline">Download in Chrome</button>
                </p>
              </>
            ) : pct === 100 ? (
              <p>Tap <b>Update</b> on the Android screen to finish. If it asked for permission, allow <b>“Allow from this source”</b> and come back.</p>
            ) : (
              <>
                <p className="font-semibold text-ink-primary">Downloading… {pct !== null && pct >= 0 ? `${pct}%` : ""}</p>
                <div className="h-2 overflow-hidden rounded-full bg-border">
                  <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(pct ?? 0, 3)}%` }} />
                </div>
              </>
            )}
          </div>
        ) : started ? (
          <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs text-ink-secondary">
            <p className="font-semibold text-ink-primary">Downloading in Chrome…</p>
            <p>1. Watch the notification bar. If Chrome asks <i>“Download anyway?”</i>, tap <b>Download</b>.</p>
            <p>2. When it finishes, tap the notification → <b>Install</b> (or <b>Update</b>).</p>
            <p>3. If Android asks, allow <b>“Install unknown apps”</b> for Chrome, then go back and tap Install.</p>
            <p className="pt-1">
              Nothing happened?{" "}
              <button type="button" onClick={startUpdate} className="font-medium text-primary underline">Try again</button>
              {" · "}
              <button type="button" onClick={tryInApp} className="font-medium text-primary underline">Open in app</button>
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">
            Tap Update — the new app downloads, then tap <b>{updater ? "Update" : "Install"}</b> when Android asks. Your data and login stay as they are.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          {!latest.force && <Button variant="outline" onClick={later}>{started ? "Close" : "Later"}</Button>}
          {!started && pct === null && !err && (
            <Button className="gap-1.5" onClick={startUpdate}>
              <Download className="h-4 w-4" /> Update
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
