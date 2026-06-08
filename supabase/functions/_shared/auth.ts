import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

export interface AuthResult {
  user: { id: string; email?: string } | null;
  error: string | null;
}

/**
 * Validates the caller's Supabase JWT from the Authorization header.
 * Returns the authenticated user or an error string.
 */
export async function requireAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "Missing or malformed Authorization header" };
  }
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { user: null, error: "Empty bearer token" };
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!
  );
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) {
    return { user: null, error: "Invalid or expired token" };
  }
  return { user: { id: user.id, email: user.email }, error: null };
}

export function unauthorizedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
