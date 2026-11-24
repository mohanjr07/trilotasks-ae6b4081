// ─────────────────────────────────────────────────────────────────────────────
//  Shared "app update available" state (Android app).
//  NativeAppUpdate checks /app-version.json and stores the result here, so the
//  notification bell, Notifications page, Settings and Profile can all show it.
// ─────────────────────────────────────────────────────────────────────────────
import { useSyncExternalStore } from "react";

export type LatestApp = { versionCode: number; versionName: string; apk: string; notes?: string; force?: boolean };

type State = { latest: LatestApp | null; installed: number; isAndroidApp: boolean; dismissed: number };
const DISMISS_KEY = "app-update-dismissed";
const readDismissed = () => { try { return Number(localStorage.getItem(DISMISS_KEY) || 0); } catch { return 0; } };
let state: State = { latest: null, installed: 0, isAndroidApp: false, dismissed: readDismissed() };
const listeners = new Set<() => void>();
const OPEN_EVT = "app-update-open";

export function setAppUpdateState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAppUpdate() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
    () => state,
  );
}

/** Hide the update card (bell, Notifications, Profile) for this version — it stays in Settings → App updates. */
export function dismissAppUpdate() {
  const v = state.latest?.versionCode ?? 0;
  try { localStorage.setItem(DISMISS_KEY, String(v)); } catch { /* ignore */ }
  setAppUpdateState({ dismissed: v });
}
/** True when the card should show outside Settings (a newer version that wasn't closed). */
export const updateVisible = (s: State) => !!s.latest && s.latest.versionCode !== s.dismissed;

/** Open the "Update available" pop-up (even if the user tapped "Later" before). */
export function openAppUpdate() { window.dispatchEvent(new Event(OPEN_EVT)); }
export function onOpenAppUpdate(fn: () => void) {
  window.addEventListener(OPEN_EVT, fn);
  return () => window.removeEventListener(OPEN_EVT, fn);
}
