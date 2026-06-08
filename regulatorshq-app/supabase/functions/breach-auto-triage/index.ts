import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { description, title, category } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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
            content: `You are an expert HIPAA Privacy Officer AI. Given a brief incident description, intelligently pre-fill the four-factor breach risk assessment fields. Extract as much useful information as possible from the narrative.\n\nYou MUST return a JSON object using the tool provided. Analyze the description carefully for:\n- Types of PHI/identifiers mentioned\n- Who the unauthorized person was\n- Whether PHI was actually viewed/acquired\n- Any mitigation steps mentioned\n- Severity assessment\n- Recommended priority\n- Estimated number of individuals affected (if mentioned)\n- Whether PHI was likely unsecured\n- Whether any statutory exception might apply`
          },
          {
            role: "user",
            content: `Incident: "${title || 'Untitled'}"\nCategory: ${category || 'unknown'}\nDescription: ${description || 'No description provided'}\n\nAuto-triage this incident and extract structured fields.`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "auto_triage",
              description: "Return structured triage data extracted from the incident description.",
              parameters: {
                type: "object",
                properties: {
                  priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Recommended priority level" },
                  estimated_affected: { type: "number", description: "Estimated number of individuals affected, 0 if unknown" },
                  phi_likely_unsecured: { type: "boolean", description: "Whether PHI was likely unsecured (not encrypted/destroyed)" },
                  possible_exception: { type: "string", enum: ["none", "unintentional_access", "inadvertent_disclosure", "good_faith_no_retain"], description: "Most likely statutory exception, or none" },
                  factor1_phi_nature: { type: "string", description: "Nature and extent of PHI involved — describe what types of data were exposed" },
                  factor1_identifiers: { type: "string", description: "Comma-separated list of identifiers involved (e.g., Name, SSN, DOB, Medical Record Number)" },
                  factor1_reidentification_risk: { type: "string", enum: ["low", "medium", "high", "unknown"], description: "Re-identification risk level" },
                  factor2_unauthorized_person: { type: "string", description: "Who received or accessed the PHI" },
                  factor2_person_obligations: { type: "string", description: "Their confidentiality obligations (HIPAA-covered, contractual, none, unknown)" },
                  factor3_likely_acquired: { type: "boolean", description: "Whether PHI was likely actually acquired or viewed (vs just potentially accessible)" },
                  factor3_notes: { type: "string", description: "Evidence or reasoning about acquisition/viewing" },
                  factor4_mitigation_noted: { type: "boolean", description: "Whether any mitigation actions were mentioned" },
                  factor4_actions: { type: "string", description: "Mitigation actions mentioned or recommended" },
                  risk_score: { type: "number", description: "Preliminary risk score 1-100, where 100 = certain reportable breach" },
                  triage_summary: { type: "string", description: "2-3 sentence triage summary with key concerns and recommended next steps" },
                  red_flags: { type: "array", items: { type: "string" }, description: "List of red flags or concerns identified" },
                  recommended_actions: { type: "array", items: { type: "string" }, description: "3-5 immediate recommended actions" }
                },
                required: ["priority", "estimated_affected", "phi_likely_unsecured", "possible_exception", "factor1_phi_nature", "factor1_identifiers", "factor1_reidentification_risk", "factor2_unauthorized_person", "factor2_person_obligations", "factor3_likely_acquired", "factor3_notes", "factor4_mitigation_noted", "factor4_actions", "risk_score", "triage_summary", "red_flags", "recommended_actions"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "auto_triage" } },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await response.text();
      console.error("AI error:", status, t);
      return new Response(JSON.stringify({ error: "AI triage failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "No triage data returned" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const triageData = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(triageData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auto-triage error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
