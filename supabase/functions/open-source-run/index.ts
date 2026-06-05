import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_TOOLS: Record<string, string> = {
  "oig-exclusion": "You are a healthcare compliance AI. Check if a given name or NPI is potentially excluded from Medicare/Medicaid programs. Analyze the input and provide a structured risk assessment. Remind users to verify against the official OIG LEIE database at exclusions.oig.hhs.gov.",
  "stark-analyzer": "You are a healthcare compliance attorney specializing in Stark Law (42 U.S.C. § 1395nn). Analyze the described physician financial arrangement for potential Stark Law violations. Identify applicable exceptions, red flags, and recommended remediation steps.",
  "hipaa-checker": "You are a HIPAA Privacy Officer. Review the described situation for potential HIPAA violations. Identify the applicable rule provisions (Privacy Rule 45 CFR Part 164 Subpart E, Security Rule 45 CFR Part 164 Subparts A and C), assess severity, and recommend corrective actions.",
  "policy-gap": "You are a healthcare compliance policy expert. Analyze the provided policy text and identify gaps relative to regulatory requirements (HIPAA, TJC, CMS, OIG). List missing elements, outdated provisions, and recommended additions.",
  "risk-scorer": "You are a compliance risk analyst. Score the described compliance risk using a structured framework. Assess likelihood (1-5), impact (1-5), inherent risk score, current controls, and residual risk. Provide a mitigation priority recommendation.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { toolId, input } = await req.json();

    if (!toolId || !input) {
      return new Response(
        JSON.stringify({ error: "toolId and input are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = ALLOWED_TOOLS[toolId];
    if (!systemPrompt) {
      return new Response(
        JSON.stringify({ error: `Unknown tool: ${toolId}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (typeof input !== "string" || input.length > 20000) {
      return new Response(
        JSON.stringify({ error: "Input must be a string under 20,000 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI usage credits exhausted. Please add credits in Settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("open-source-run error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
