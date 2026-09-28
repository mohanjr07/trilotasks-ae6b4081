// ─────────────────────────────────────────────────────────────────────────────
//  send-push: a new row in `notifications` → push to that user's phones (FCM)
//
//  Called by the database trigger `send_push_on_notification` with just the
//  notification id. Like send-email-notification, we don't trust the payload:
//  the row is re-read with the service role and marked push_sent so it can
//  only ever be pushed once.
//
//  Android phones → Firebase Cloud Messaging (secret FCM_SERVICE_ACCOUNT)
//  iPhones        → Apple Push Notification service directly
//                   (secrets APNS_KEY = .p8 file contents, APNS_KEY_ID,
//                    APNS_TEAM_ID, optional APNS_BUNDLE_ID)
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let cachedToken: { value: string; exp: number } | null = null;

async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  cachedToken = { value: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

// ── Apple (APNs) ────────────────────────────────────────────────────────────
let cachedApnsJwt: { value: string; iat: number } | null = null;

async function apnsJwt(keyP8: string, keyId: string, teamId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedApnsJwt && now - cachedApnsJwt.iat < 50 * 60) return cachedApnsJwt.value;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: now }));
  const pem = keyP8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  cachedApnsJwt = { value: jwt, iat: now };
  return jwt;
}

/** Returns "ok", "dead" (token no longer valid) or "error". Tries production, then sandbox (Xcode debug builds). */
async function sendApns(token: string, body: unknown, jwt: string, topic: string): Promise<"ok" | "dead" | "error"> {
  for (const host of ["api.push.apple.com", "api.sandbox.push.apple.com"]) {
    const res = await fetch(`https://${host}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return "ok";
    const err = await res.text();
    if (res.status === 410) return "dead";
    // Token from the other environment → try the next host
    if (res.status === 400 && /BadDeviceToken/.test(err)) continue;
    console.error("APNs error", host, res.status, err);
    return "error";
  }
  return "dead";
}

const routeFor = (type: string | null) =>
  type === "task" ? "/notifications"
  : type === "leave" ? "/notifications"
  : type === "payment" ? "/payments"
  : "/notifications";

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    const sa: ServiceAccount | null = saRaw ? JSON.parse(saRaw) : null;
    const apnsKey = Deno.env.get("APNS_KEY");
    const apnsKeyId = Deno.env.get("APNS_KEY_ID");
    const apnsTeamId = Deno.env.get("APNS_TEAM_ID");
    const apnsTopic = Deno.env.get("APNS_BUNDLE_ID") ?? "com.triloautomation.taskflow";

    const payload = await req.json().catch(() => ({}));
    const id = payload?.record?.id;
    if (!id || typeof id !== "string") return json({ error: "Missing notification id" }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Claim the row atomically: only the first call gets it back
    const { data: rows, error } = await admin
      .from("notifications")
      .update({ push_sent: true })
      .eq("id", id)
      .or("push_sent.is.null,push_sent.eq.false")
      .select("id, user_id, title, body, type");
    if (error) throw error;
    const n = rows?.[0];
    if (!n) return json({ ok: true, skipped: "not_found_or_already_sent" });

    const { data: tokens } = await admin.from("push_tokens").select("token, platform").eq("user_id", n.user_id);
    if (!tokens?.length) return json({ ok: true, skipped: "no_devices" });

    const { count: unread } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", n.user_id)
      .eq("is_read", false);

    let sent = 0;
    const dead: string[] = [];
    const route = routeFor(n.type);

    // iPhones
    const iosTokens = tokens.filter((t) => t.platform === "ios");
    if (iosTokens.length) {
      if (!apnsKey || !apnsKeyId || !apnsTeamId) {
        console.warn("iPhone tokens present but APNS_* secrets are not set");
      } else {
        const jwt = await apnsJwt(apnsKey, apnsKeyId, apnsTeamId);
        const body = {
          aps: { alert: { title: n.title, body: n.body }, sound: "default", badge: unread ?? undefined, "thread-id": n.type ?? "taskflow" },
          route,
          notification_id: n.id,
        };
        for (const { token } of iosTokens) {
          const r = await sendApns(token, body, jwt, apnsTopic);
          if (r === "ok") sent++;
          else if (r === "dead") dead.push(token);
        }
      }
    }

    // Android phones
    const androidTokens = tokens.filter((t) => t.platform !== "ios");
    if (androidTokens.length && !sa) console.warn("Android tokens present but FCM_SERVICE_ACCOUNT is not set");
    const accessToken = androidTokens.length && sa ? await googleAccessToken(sa) : "";
    const endpoint = sa ? `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send` : "";

    for (const { token } of (sa ? androidTokens : [])) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: n.title, body: n.body },
            data: { route, notification_id: n.id },
            android: {
              priority: "HIGH",
              notification: {
                channel_id: "taskflow",
                icon: "ic_stat_taskflow",
                color: "#5C5FEF",
                sound: "default",
                tag: n.id,
                notification_count: unread ?? undefined,
              },
            },
          },
        }),
      });
      if (res.ok) { sent++; continue; }
      const err = await res.text();
      // Phone uninstalled the app / token expired → forget it
      if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token|registration-token-not-registered/i.test(err)) {
        dead.push(token);
      } else {
        console.error("FCM error", res.status, err);
      }
    }
    if (dead.length) await admin.from("push_tokens").delete().in("token", dead);

    return json({ ok: true, sent, removed: dead.length });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
