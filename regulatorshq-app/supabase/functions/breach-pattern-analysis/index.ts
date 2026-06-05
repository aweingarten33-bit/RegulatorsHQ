import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: incidents } = await supabase
      .from("privacy_incidents")
      .select("incident_title, category, individuals_affected, status, priority, state_jurisdiction, discovered_date, factor1_phi_nature, factor1_identifiers, factor2_unauthorized_person, ai_risk_score, is_reportable_breach, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!incidents?.length) {
      return new Response(JSON.stringify({ error: "No incidents to analyze" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
          {
            role: "system",
            content: `You are a Chief Privacy Officer analyzing breach incident patterns. Analyze the incident data and provide:\n\n1. **Trend Analysis**: Identify patterns in breach categories, timing, and severity\n2. **Root Cause Patterns**: Common themes across incidents\n3. **Departmental Risk Hotspots**: Where incidents concentrate\n4. **Regulatory Exposure**: OCR enforcement risk based on patterns\n5. **Predictive Insights**: Where the next breach is likely to come from\n6. **Benchmark Comparison**: How this compares to HHS breach report data\n7. **Priority Recommendations**: Top 3 actions to reduce breach risk\n\nFormat with markdown. Be direct, data-driven, max 400 words. Use bullet points.`
          },
          {
            role: "user",
            content: `Analyze these ${incidents.length} privacy incidents:\n\n${JSON.stringify(incidents, null, 2)}`
          }
        ],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Pattern analysis failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("pattern-analysis error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
