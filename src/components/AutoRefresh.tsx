// ─────────────────────────────────────────────────────────────────────────────
//  Keeps every device up to date (website, Android app, iPhone home-screen app):
//   • data on screen refreshes every 5 seconds (see QueryClient in App.tsx),
//     and straight away when the app comes back to the front
//   • when a new version of TaskFlow is published, the app reloads itself
//     (only when nobody is typing or has a pop-up open, so nothing is lost)
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const VERSION_CHECK_MS = 60_000;

const currentBundle = () =>
  Array.from(document.scripts).map((s) => s.src).find((s) => /\/assets\/index-[^/]+\.js/.test(s))?.match(/index-[^/]+\.js/)?.[0] ?? null;

async function latestBundle(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.text()).match(/index-[^/"']+\.js/)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Nothing would be lost by reloading right now. */
const safeToReload = () => {
  const a = document.activeElement as HTMLElement | null;
  const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
  const dialogOpen = !!document.querySelector('[role="dialog"], [role="alertdialog"]');
  return !typing && !dialogOpen;
};

export default function AutoRefresh() {
  const qc = useQueryClient();
  const pending = useRef(false);
  const notified = useRef(false);

  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return; // local dev server — nothing to compare

    const check = async () => {
      if (!pending.current) {
        const latest = await latestBundle();
        if (latest && latest !== mine) pending.current = true;
      }
      if (!pending.current) return;
      if (safeToReload()) {
        window.location.reload();
      } else if (!notified.current) {
        notified.current = true;
        toast("A new version of TaskFlow is ready", {
          description: "It will load automatically when you finish — or tap Refresh.",
          action: { label: "Refresh", onClick: () => window.location.reload() },
          duration: 15000,
        });
      }
    };

    const id = window.setInterval(check, VERSION_CHECK_MS);
    // once a new version is known, try again every few seconds so it applies as soon as it's safe
    const retry = window.setInterval(() => { if (pending.current && safeToReload()) window.location.reload(); }, 5000);
    return () => { window.clearInterval(id); window.clearInterval(retry); };
  }, []);

  // Coming back to the app (phone unlocked, tab switched back, app resumed) → refresh now
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      qc.invalidateQueries();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [qc]);

  return null;
}
