import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CreateUserPayload = {
  full_name: string;
  email: string;
  role: "admin" | "manager" | "employee";
  department?: string | null;
  position?: string | null;
  phone?: string | null;
  passwordMode: "email" | "password";
  password?: string;
  redirectTo?: string;
};

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
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
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

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: callerProfile, error: callerError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (callerError || !callerProfile || !["admin", "super_admin"].includes(callerProfile.role ?? "")) {
      return json({ error: "Only admins can create users" }, 403);
    }

    const body = (await req.json()) as CreateUserPayload;

    if (!body.full_name?.trim() || !body.email?.trim() || !body.role) {
      return json({ error: "Missing required fields" }, 400);
    }

    if (!["admin", "manager", "employee"].includes(body.role)) {
      return json({ error: "Invalid role" }, 400);
    }

    if (body.passwordMode === "password" && (!body.password || body.password.length < 8)) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

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
      created_by: user.id,
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