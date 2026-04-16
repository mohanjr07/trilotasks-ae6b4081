import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UpdateUserSchema = z.object({
  userId: z.string().uuid(),
  full_name: z.string().trim().min(1).max(100),
  role: z.enum(["admin", "manager", "employee"]),
  department: z.string().trim().max(100).nullable().optional(),
  position: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
});

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

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
      global: {
        headers: { Authorization: authHeader },
      },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const callerId = claimsData?.claims?.sub;

    if (claimsError || !callerId) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: callerProfile, error: callerError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .maybeSingle();

    if (callerError || !callerProfile || !["admin", "super_admin"].includes(callerProfile.role ?? "")) {
      return json({ error: "Only admins can update users" }, 403);
    }

    const parsedBody = UpdateUserSchema.safeParse(await req.json());
    if (!parsedBody.success) {
      return json({ error: parsedBody.error.flatten().fieldErrors }, 400);
    }

    const body = parsedBody.data;

    if (body.userId === callerId && body.role !== "admin") {
      return json({ error: "You cannot remove your own admin role" }, 400);
    }

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({
        full_name: body.full_name,
        role: body.role,
        department: body.department || null,
        position: body.position || null,
        phone: body.phone || null,
      })
      .eq("id", body.userId);

    if (updateError) {
      return json({ error: updateError.message }, 400);
    }

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});