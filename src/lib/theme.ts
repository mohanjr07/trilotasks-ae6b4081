// ─────────────────────────────────────────────────────────────────────────────
//  Theme: "auto" (dark on phones / mobile app, light on computers), "light" or "dark".
//  Saved on the device (localStorage "theme-v2", read before the app loads in
//  index.html) and in the user's account, so it follows them to other devices.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "@/integrations/supabase/client";

export type ThemePref = "auto" | "light" | "dark";
const KEY = "theme-v2";
const EVT = "themepref-change";

export function getThemePref(): ThemePref {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch { return "auto"; }
}

export function autoIsDark(): boolean {
  const cap = (window as any).Capacitor;
  const isApp = !!(cap && (cap.isNativePlatform ? cap.isNativePlatform() : cap.isNative));
  return isApp || window.matchMedia("(max-width: 767.98px)").matches;
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === "auto" ? autoIsDark() : pref === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0a0f1b" : "#ffffff");
  window.dispatchEvent(new CustomEvent(EVT, { detail: { pref, dark } }));
  return dark;
}

function storeLocal(pref: ThemePref) {
  try { pref === "auto" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, pref); } catch { /* ignore */ }
}

/** Change the theme: applies it now, saves it on this device and in the account. */
export async function setThemePref(pref: ThemePref) {
  storeLocal(pref);
  applyTheme(pref);
  try { await supabase.auth.updateUser({ data: { theme_pref: pref } }); } catch { /* offline: kept on this device */ }
}

/** After login: use the theme saved in the account (if any). */
export function syncThemeFromAccount(meta: Record<string, any> | undefined | null) {
  const saved = meta?.theme_pref;
  if (saved !== "auto" && saved !== "light" && saved !== "dark") return;
  if (saved === getThemePref()) return;
  storeLocal(saved);
  applyTheme(saved);
}

export function onThemeChange(fn: (dark: boolean, pref: ThemePref) => void) {
  const h = (e: Event) => { const d = (e as CustomEvent).detail; fn(d.dark, d.pref); };
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}
