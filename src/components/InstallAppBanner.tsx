// Shows a small "Install the app" card on phones (not on desktop, not once installed).
// Android/Chrome: one-tap install. iPhone/Safari: shows the Share → Add to Home Screen steps.
import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/platform";

const KEY = "taskflow-install-dismissed";

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export default function InstallAppBanner() {
  const [prompt, setPrompt] = useState<any>(null);
  const [show, setShow] = useState(false);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isPhone = /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    if ((window as any).IS_ELECTRON || isNativeApp || !isPhone || isStandalone()) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(KEY) === "1"; } catch { /* ignore */ }
    if (dismissed) return;

    if (isIOS) { setShow(true); return; }
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e); setShow(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
  };

  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    setPrompt(null);
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-accent-light p-3">
      <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-lg shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-primary">Install the TaskFlow app</p>
        {isIOS ? (
          <p className="text-xs text-ink-secondary mt-0.5">
            Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> Share, then <b>Add to Home Screen</b>.
          </p>
        ) : (
          <p className="text-xs text-ink-secondary mt-0.5">Open it from your home screen like any other app.</p>
        )}
        {!isIOS && prompt && (
          <Button size="sm" className="mt-2 h-8 gap-1.5" onClick={install}>
            <Download className="h-3.5 w-3.5" /> Install
          </Button>
        )}
      </div>
      <button onClick={dismiss} className="text-ink-muted hover:text-ink-primary shrink-0" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
