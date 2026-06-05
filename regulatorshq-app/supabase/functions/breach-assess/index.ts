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
    const { incident } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a HIPAA Privacy Officer AI performing a breach risk assessment under 45 CFR §164.402. You MUST apply the HHS four-factor test rigorously and produce a defensible written determination.\n\nDECISION TREE (follow in order):\n1. Was the PHI "unsecured" (not encrypted per NIST or properly destroyed)?  \n   - If secured → NOT a breach. Stop.\n2. Does one of the three statutory exceptions apply?\n   - (a) Unintentional acquisition by workforce member acting in good faith, within scope\n   - (b) Inadvertent disclosure between authorized persons at same CE/BA\n   - (c) Good faith belief that unauthorized person could not retain the PHI\n   - If exception applies → NOT a reportable breach. Stop.\n3. Apply the FOUR-FACTOR risk assessment:\n   Factor 1: Nature and extent of PHI involved (types of identifiers, clinical info, SSN, financial data). Assess re-identification risk.\n   Factor 2: Who was the unauthorized person who used/received the PHI? What are their obligations (e.g., another covered entity, random stranger, etc.)?\n   Factor 3: Was the PHI actually acquired or viewed (vs. opportunity for access)?\n   Factor 4: Extent to which risk has been mitigated (attestations of destruction, assurances from recipient, etc.)\n4. DETERMINATION: Based on the four factors, conclude whether there is a "low probability that the PHI has been compromised" or whether it IS a reportable breach.\n\nOUTPUT FORMAT (use markdown):\n## Risk Assessment Summary\n- **Determination**: [LOW PROBABILITY — Not a reportable breach | REPORTABLE BREACH | INSUFFICIENT INFORMATION]\n- **Confidence**: [High/Medium/Low]\n- **Risk Score**: [1-100, where 100 = certain breach]\n\n## Factor-by-Factor Analysis\n\n### Factor 1: Nature and Extent of PHI\n[Analysis with specific identifiers cited]\n\n### Factor 2: Unauthorized Person\n[Analysis of who received/accessed and their obligations]\n\n### Factor 3: Acquisition or Viewing\n[Was PHI actually acquired/viewed or just potentially accessible?]\n\n### Factor 4: Risk Mitigation\n[What mitigation steps were taken and their effectiveness]\n\n## Notification Requirements\n- **Individual notification required**: [Yes/No/TBD]\n- **HHS/OCR notification required**: [Yes/No/TBD]  \n- **60-day deadline from discovery**: [Calculate from discovered_date]\n- **Media notification required (500+ in a state)**: [Yes/No/TBD]\n- **State AG notification**: [Check based on state jurisdiction]\n\n## Recommended Next Steps\n[Bulleted list, max 5 items]\n\n## Documentation Notes\n[Any gaps in the information provided that should be investigated further]\n\nKeep analysis under 400 words. Be direct, cite specific regulatory references. This determination must be defensible in an OCR investigation.`;

    const userPrompt = `Perform a HIPAA breach risk assessment on this incident:\n\n**Incident Title**: ${incident.incident_title || "Not provided"}\n**Incident Date**: ${incident.incident_date || "Not provided"}\n**Discovery Date**: ${incident.discovered_date || "Not provided"}\n**Description**: ${incident.incident_description || "Not provided"}\n**Category**: ${incident.category || "Not provided"}\n**Individuals Affected**: ${incident.individuals_affected || "Unknown"}\n**State Jurisdiction**: ${incident.state_jurisdiction || "Not specified"}\n\n**PHI Status**:\n- Unsecured: ${incident.phi_unsecured ? "Yes" : "No"}\n- Secured method: ${incident.phi_secured_method || "N/A"}\n\n**Exception Check**:\n- Exception applies: ${incident.exception_applies ? "Yes" : "No"}\n- Exception type: ${incident.exception_type || "N/A"}\n- Exception notes: ${incident.exception_notes || "N/A"}\n\n**Factor 1 — Nature of PHI**:\n- PHI nature: ${incident.factor1_phi_nature || "Not provided"}\n- Identifiers involved: ${incident.factor1_identifiers || "Not provided"}\n- Re-identification risk: ${incident.factor1_reidentification_risk || "Unknown"}\n\n**Factor 2 — Unauthorized Person**:\n- Who: ${incident.factor2_unauthorized_person || "Not provided"}\n- Their obligations: ${incident.factor2_person_obligations || "Not provided"}\n\n**Factor 3 — Acquisition/Viewing**:\n- PHI actually acquired or viewed: ${incident.factor3_phi_acquired_or_viewed === true ? "Yes" : incident.factor3_phi_acquired_or_viewed === false ? "No" : "Unknown"}\n- Notes: ${incident.factor3_acquisition_notes || "Not provided"}\n\n**Factor 4 — Mitigation**:\n- Risk mitigated: ${incident.factor4_risk_mitigated ? "Yes" : "No"}\n- Mitigation actions: ${incident.factor4_mitigation_actions || "Not provided"}\n- Mitigation confirmed: ${incident.factor4_mitigation_confirmed ? "Yes" : "No"}\n\nProvide your full four-factor analysis and breach determination.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("breach-assess error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
