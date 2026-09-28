// "Get the app" card shown to phone users browsing the website.
//  • Android → download the TaskFlow Android app (APK hosted on this site)
//  • iPhone  → Share → Add to Home Screen
// Hidden inside the Android app itself, on desktop, and once dismissed.
import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { isNativeApp } from "@/lib/platform";

export const ANDROID_APK_URL = "/download/TaskFlow.apk";
const KEY = "taskflow-install-dismissed";

const isAndroid = () => /android/i.test(navigator.userAgent);
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

export default function InstallAppBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if ((window as any).IS_ELECTRON || isNativeApp || isStandalone()) return;
    if (!isAndroid() && !isIOS()) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === "1"; } catch { /* ignore */ }
    if (!dismissed) setShow(true);
  }, []);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
  };

  if (!show) return null;
  const android = isAndroid();

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/20 bg-accent-light p-3">
      <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl shrink-0 shadow-sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-primary">TaskFlow app</p>
        {android ? (
          <p className="text-xs text-ink-secondary leading-snug">Faster, full-screen, with notifications.</p>
        ) : (
          <p className="text-xs text-ink-secondary leading-snug">
            Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> Share → <b>Add to Home Screen</b>
          </p>
        )}
      </div>
      {android && (
        <a
          href={ANDROID_APK_URL}
          download="TaskFlow.apk"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shrink-0"
        >
          <Download className="h-3.5 w-3.5" /> Get app
        </a>
      )}
      <button onClick={dismiss} className="-mr-1 p-1 text-ink-muted hover:text-ink-primary shrink-0" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
