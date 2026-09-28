// Validates the incoming notification against the database before sending
// any email. The trigger authenticates with the anon key (publicly known),
// so we cannot trust the request payload — we look the notification up
// server-side using the service role and refuse to send anything that isn't
// a real, un-emailed row.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Missing backend configuration" }, 500);
    }

    const payload = await req.json().catch(() => ({}));
    const recordId = payload?.record?.id;
    if (!recordId || typeof recordId !== "string") {
      return json({ error: "Missing notification id" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Verify the notification actually exists in the DB and hasn't been sent.
    // This is what stops the anon key from being abused as a spam relay:
    // the request payload is ignored, only the real DB row is used.
    const { data: notif, error: fetchError } = await admin
      .from("notifications")
      .select("id, user_id, title, body, email_sent")
      .eq("id", recordId)
      .maybeSingle();

    if (fetchError) return json({ error: fetchError.message }, 500);
    if (!notif) return json({ ok: true, skipped: "not_found" });
    if (notif.email_sent) return json({ ok: true, skipped: "already_sent" });

    // Atomically claim the send so concurrent invocations can't double-email.
    const { data: claimed } = await admin
      .from("notifications")
      .update({ email_sent: true })
      .eq("id", notif.id)
      .eq("email_sent", false)
      .select("id")
      .maybeSingle();
    if (!claimed) return json({ ok: true, skipped: "race" });

    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", notif.user_id)
      .maybeSingle();

    if (!profile?.email) {
      console.warn(`No email on profile ${notif.user_id}`);
      return json({ ok: true, skipped: "no_email" });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY secret is not set");
      await admin.from("notifications").update({ email_sent: false }).eq("id", notif.id);
      return json({ ok: false, skipped: "email_disabled" });
    }

    const from = Deno.env.get("RESEND_FROM") ??
      "Trilo <onboarding@resend.dev>";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [profile.email],
        subject: notif.title,
        html: `<p>Hi ${profile.full_name ?? "there"},</p><p>${notif.body}</p>`,
      }),
    });

    const resText = await emailRes.text();
    if (!emailRes.ok) {
      // Log Resend's real reason (unverified domain, bad key, etc.) and
      // release the claim so the email can be retried later.
      console.error(`Resend ${emailRes.status} from=${from} to=${profile.email}: ${resText}`);
      await admin.from("notifications").update({ email_sent: false }).eq("id", notif.id);
    } else {
      console.log(`Email sent to ${profile.email}: ${resText}`);
    }
    return json({ ok: emailRes.ok, status: emailRes.status, resend: resText });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
