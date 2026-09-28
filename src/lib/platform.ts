// Where is Task Flow running?  Website, Windows/Mac desktop app, or the Android app.
export const PUBLIC_SITE = "https://taskflow.triloautomation.com";

// The Android app (Capacitor) injects window.Capacitor before the page loads.
export const isNativeApp =
  typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();

export const isElectron = typeof window !== "undefined" && !!(window as any).IS_ELECTRON;

// Base URL for links in emails (password setup / reset). Inside the phone app the page
// origin is https://localhost, which is useless in an email, so use the real site.
export const appOrigin = () => (isNativeApp ? PUBLIC_SITE : window.location.origin);
