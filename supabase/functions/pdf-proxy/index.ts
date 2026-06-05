import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_SCHEMES = ["https:"];
const BLOCKED_HOSTS = [
  "localhost", "127.0.0.1", "0.0.0.0", "::1",
  "169.254.169.254", "metadata.google.internal",
];

function isUrlSafe(raw: string): { ok: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return { ok: false, reason: "Only https:// URLs are permitted" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
    return { ok: false, reason: "Internal/loopback addresses are not permitted" };
  }
  // Block private IP ranges
  const privateRanges = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];
  if (privateRanges.some((re) => re.test(hostname))) {
    return { ok: false, reason: "Private IP ranges are not permitted" };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  let pdfUrl: string | null = null;

  if (req.method === "GET") {
    pdfUrl = new URL(req.url).searchParams.get("url");
  } else {
    try {
      const body = await req.json();
      pdfUrl = body.url;
    } catch {
      return new Response("Invalid request body", { status: 400, headers: corsHeaders });
    }
  }

  if (!pdfUrl || typeof pdfUrl !== "string") {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const safety = isUrlSafe(pdfUrl);
  if (!safety.ok) {
    return new Response(JSON.stringify({ error: safety.reason }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const pdfResp = await fetch(pdfUrl, {
      headers: {
        "Accept": "application/pdf,*/*",
        "User-Agent": "Mozilla/5.0 (compatible; PolicyViewer/1.0)",
      },
      redirect: "manual",
    });

    if (pdfResp.status >= 300 && pdfResp.status < 400) {
      return new Response(JSON.stringify({ error: "Redirects are not followed" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pdfResp.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch PDF: ${pdfResp.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = pdfResp.headers.get("content-type") || "";
    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      return new Response(JSON.stringify({ error: "Remote URL did not return a PDF" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pdfBytes = await pdfResp.arrayBuffer();

    return new Response(pdfBytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("pdf-proxy error:", e);
    return new Response(JSON.stringify({ error: "Failed to proxy PDF" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
