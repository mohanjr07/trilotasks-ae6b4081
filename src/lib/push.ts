// ─────────────────────────────────────────────────────────────────────────────
//  Push notifications (Android app only, via Firebase Cloud Messaging)
//   • asks the user for permission once
//   • saves this phone's token in `push_tokens` for the logged-in user
//   • tapping a notification opens the right page in the app
//  Uses the native plugin exposed on window.Capacitor.Plugins, so the website
//  build needs no extra packages. Does nothing on web/desktop.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/platform";

const plugin = () => (window as any).Capacitor?.Plugins?.PushNotifications;
const TOKEN_KEY = "taskflow-push-token";
let started = false;

export async function initPush(navigate: (path: string) => void): Promise<void> {
  const Push = plugin();
  if (!isNativeApp || !Push || started) return;
  started = true;

  try {
    // Heads-up (pop-down) notifications with sound on Android 8+
    await Push.createChannel?.({
      id: "taskflow",
      name: "TaskFlow",
      description: "Tasks, leave, payments and other TaskFlow updates",
      importance: 5,
      visibility: 1,
      sound: "default",
      vibration: true,
      lights: true,
    }).catch(() => {});

    await Push.addListener("registration", async ({ value }: { value: string }) => {
      try { localStorage.setItem(TOKEN_KEY, value); } catch { /* ignore */ }
      const { error } = await (supabase.rpc as any)("claim_push_token", { p_token: value, p_platform: "android" });
      if (error) console.warn("Could not save push token", error.message);
    });
    await Push.addListener("registrationError", (e: any) => console.warn("Push registration failed", e));

    // Tapped a notification (app in background or closed)
    await Push.addListener("pushNotificationActionPerformed", (action: any) => {
      const route = action?.notification?.data?.route;
      navigate(typeof route === "string" && route.startsWith("/") ? route : "/notifications");
    });

    let perm = await Push.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await Push.requestPermissions();
    }
    if (perm.receive !== "granted") return;
    await Push.register();
  } catch (e) {
    console.warn("Push setup failed", e);
    started = false;
  }
}

/** Call before signing out so the old user stops getting this phone's pushes. */
export async function removePushToken(): Promise<void> {
  if (!isNativeApp) return;
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
  if (!token) return;
  await supabase.from("push_tokens" as any).delete().eq("token", token);
  started = false;
}
