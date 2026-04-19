import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CreateUserSchema = z.object({
  full_name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  role: z.enum(["admin", "manager", "employee", "intern", "intern_admin"]),
  department: z.string().trim().max(100).nullable().optional(),
  position: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  passwordMode: z.enum(["email", "password"]),
  password: z.string().min(8).optional(),
  redirectTo: z.string().url().optional(),
}).superRefine((value, ctx) => {
  if (value.passwordMode === "password" && !value.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Password must be at least 8 characters",
      path: ["password"],
    });
  }
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

    if (!authHeader) {
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
    const userId = claimsData?.claims?.sub;

    if (claimsError || !userId) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: callerProfile, error: callerError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (callerError || !callerProfile || !["admin", "super_admin"].includes(callerProfile.role ?? "")) {
      return json({ error: "Only admins can create users" }, 403);
    }

    const parsedBody = CreateUserSchema.safeParse(await req.json());
    if (!parsedBody.success) {
      return json({ error: parsedBody.error.flatten().fieldErrors }, 400);
    }

    const body = parsedBody.data;

    let createdUserId: string | null = null;

    if (body.passwordMode === "email") {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(body.email, {
        data: { full_name: body.full_name },
        redirectTo: body.redirectTo,
      });

      if (error) {
        return json({ error: error.message }, 400);
      }

      createdUserId = data.user?.id ?? null;
    } else {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: body.email,
        password: body.password!,
        email_confirm: true,
        user_metadata: { full_name: body.full_name },
      });

      if (error) {
        return json({ error: error.message }, 400);
      }

      createdUserId = data.user?.id ?? null;
    }

    if (!createdUserId) {
      return json({ error: "Failed to create user" }, 500);
    }

    const { error: profileError } = await adminClient.from("profiles").upsert({
      id: createdUserId,
      email: body.email,
      full_name: body.full_name,
      role: body.role,
      department: body.department || null,
      position: body.position || null,
      phone: body.phone || null,
      created_by: userId,
      is_active: true,
    });

    if (profileError) {
      return json({ error: profileError.message }, 400);
    }

    return json({ success: true, userId: createdUserId, mode: body.passwordMode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
