// ─────────────────────────────────────────────────────────────────────────────
//  send-push: a new row in `notifications` → push to that user's phones (FCM)
//
//  Called by the database trigger `send_push_on_notification` with just the
//  notification id. Like send-email-notification, we don't trust the payload:
//  the row is re-read with the service role and marked push_sent so it can
//  only ever be pushed once.
//
//  Secret needed:  FCM_SERVICE_ACCOUNT = the Firebase service-account JSON
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
    if (!saRaw) return json({ error: "FCM_SERVICE_ACCOUNT secret not set" }, 500);
    const sa: ServiceAccount = JSON.parse(saRaw);

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

    const { data: tokens } = await admin.from("push_tokens").select("token").eq("user_id", n.user_id);
    if (!tokens?.length) return json({ ok: true, skipped: "no_devices" });

    const { count: unread } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", n.user_id)
      .eq("is_read", false);

    const accessToken = await googleAccessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    let sent = 0;
    const dead: string[] = [];

    for (const { token } of tokens) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: n.title, body: n.body },
            data: { route: routeFor(n.type), notification_id: n.id },
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
