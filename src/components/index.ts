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
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Missing Supabase configuration" }, 500);
    }

    if (!resendApiKey) {
      // Gracefully skip email sending if Resend not configured yet
      console.warn("RESEND_API_KEY not set – skipping email send");
      return json({ success: true, skipped: true });
    }

    const body = await req.json();
    const { to_email, to_name, subject, html_body, notification_id } = body;

    if (!to_email || !subject || !html_body) {
      return json({ error: "Missing required fields: to_email, subject, html_body" }, 400);
    }

    // Send email via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Trilo Tasks <notifications@trilotasks.com>",
        to: [to_email],
        subject,
        html: html_body,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error("Resend error:", resendData);
      return json({ error: "Failed to send email", details: resendData }, 500);
    }

    // Mark notification email_sent = true in DB
    if (notification_id) {
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      await adminClient
        .from("notifications")
        .update({ email_sent: true })
        .eq("id", notification_id);
    }

    return json({ success: true, email_id: resendData.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("Edge function error:", message);
    return json({ error: message }, 500);
  }
});
