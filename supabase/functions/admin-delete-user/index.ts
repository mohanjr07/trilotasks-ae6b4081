import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BodySchema = z.object({ userId: z.string().uuid() });

const throwIfError = (step: string, error: { message: string } | null) => {
  if (error) {
    throw new Error(`${step}: ${error.message}`);
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
      return json({ error: "Missing backend configuration" }, 500);
    }
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const callerId = claimsData?.claims?.sub;

    if (claimsError || !callerId) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .maybeSingle();

    if (!callerProfile || !["admin", "super_admin"].includes(callerProfile.role ?? "")) {
      return json({ error: "Only admins can delete users" }, 403);
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: "Invalid userId" }, 400);
    }

    const { userId } = parsed.data;

    if (userId === callerId) {
      return json({ error: "You cannot delete your own account" }, 400);
    }

    const [{ error: clearCreatedByError }, { error: clearReviewedByError }] = await Promise.all([
      adminClient.from("profiles").update({ created_by: null }).eq("created_by", userId),
      adminClient.from("leave_requests").update({ reviewed_by: null }).eq("reviewed_by", userId),
    ]);

    throwIfError("Failed to clear profile creator references", clearCreatedByError);
    throwIfError("Failed to clear leave reviewer references", clearReviewedByError);

    const [{ error: deletePrefsError }, { error: deleteNotificationsError }, { error: deleteOwnLeavesError }] = await Promise.all([
      adminClient.from("notification_preferences").delete().eq("user_id", userId),
      adminClient.from("notifications").delete().eq("user_id", userId),
      adminClient.from("leave_requests").delete().eq("employee_id", userId),
    ]);

    throwIfError("Failed to delete notification preferences", deletePrefsError);
    throwIfError("Failed to delete notifications", deleteNotificationsError);
    throwIfError("Failed to delete leave requests", deleteOwnLeavesError);

    const { error: deleteTasksError } = await adminClient
      .from("tasks")
      .delete()
      .or(`assigned_to.eq.${userId},assigned_by.eq.${userId}`);

    throwIfError("Failed to delete tasks", deleteTasksError);

    const [{ error: deleteCommentsError }, { error: deleteAttachmentsError }] = await Promise.all([
      adminClient.from("task_comments").delete().eq("user_id", userId),
      adminClient.from("task_attachments").delete().eq("uploaded_by", userId),
    ]);

    throwIfError("Failed to delete task comments", deleteCommentsError);
    throwIfError("Failed to delete task attachments", deleteAttachmentsError);

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteError && !/user not found/i.test(deleteError.message)) {
      return json({ error: deleteError.message }, 400);
    }

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
