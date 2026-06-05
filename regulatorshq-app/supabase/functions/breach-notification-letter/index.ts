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
    const { incident, letterType, orgName } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const letterPrompts: Record<string, string> = {
      individual: `Generate a formal HIPAA breach notification letter to an affected individual per 45 CFR §164.404(c)-(d). The letter MUST include:\n1. Brief description of the breach, including dates of breach and discovery\n2. Description of the types of unsecured PHI involved  \n3. Steps the individual should take to protect themselves (credit monitoring, password changes, etc.)\n4. Description of the organization's investigation and mitigation actions\n5. Contact procedures for more information (toll-free number, email, website)\n6. If applicable, identity theft protection services being offered\n\nUse a professional, empathetic tone. Address "Dear [Patient/Individual Name]". Sign from "[Privacy Officer Name], Privacy Officer".`,

      hhs: `Generate an HHS/OCR breach notification report summary per 45 CFR §164.408. Format as a structured report suitable for electronic submission. Include:\n1. Covered entity name and contact information\n2. Business associate involvement (if any)\n3. Date of breach and date of discovery\n4. Type of breach (theft, loss, unauthorized access, etc.)\n5. Location of breach (paper, email, EHR, etc.)\n6. Types of PHI involved\n7. Number of individuals affected\n8. Safeguards in place at time of breach\n9. Actions taken in response\n10. Whether law enforcement was involved`,

      media: `Generate a media notification per 45 CFR §164.406 suitable for press release to local media outlets. This is required because 500+ individuals in a state/jurisdiction were affected. Include:\n1. Organization name and description\n2. Brief, factual description of the breach\n3. Types of information involved (avoid clinical details)\n4. Steps being taken to protect affected individuals\n5. How individuals can get more information\n6. Contact information for media inquiries\n\nUse clear, non-technical language suitable for general public.`,

      state_ag: `Generate a state Attorney General breach notification letter. Include:\n1. Organization details and contact information\n2. Description of the data breach\n3. Types of personal information involved\n4. Number of state residents affected\n5. Timeline of events (breach, discovery, notification)\n6. Steps taken to address the breach\n7. Services offered to affected individuals\n8. Contact information for the AG's office inquiries`,

      corrective_action: `Generate a comprehensive corrective action plan (CAPA) based on this breach incident. Include:\n1. Root cause analysis framework\n2. Immediate containment actions\n3. Short-term corrective measures (30 days)\n4. Long-term preventive measures (90 days)\n5. Training requirements\n6. Policy/procedure updates needed\n7. Technology/system improvements\n8. Monitoring and verification plan\n9. Responsible parties and deadlines\n10. Metrics for measuring effectiveness`
    };

    const systemPrompt = letterPrompts[letterType] || letterPrompts.individual;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt + `\n\nOrganization name: ${orgName || "[Organization Name]"}\n\nKeep it professional and legally sound. Use markdown formatting.` },
          {
            role: "user", content: `Generate the ${letterType} notification/document for this incident:\n\n**Title**: ${incident.incident_title || "Not provided"}\n**Date of Breach**: ${incident.incident_date || "Not provided"}\n**Date of Discovery**: ${incident.discovered_date || "Not provided"}\n**Description**: ${incident.incident_description || "Not provided"}\n**Category**: ${incident.category || "Not provided"}\n**Individuals Affected**: ${incident.individuals_affected || "Unknown"}\n**State**: ${incident.state_jurisdiction || "Not specified"}\n**PHI Types**: ${incident.factor1_phi_nature || "Not specified"}\n**Identifiers**: ${incident.factor1_identifiers || "Not specified"}\n**Unauthorized Person**: ${incident.factor2_unauthorized_person || "Not specified"}\n**Mitigation Actions**: ${incident.factor4_mitigation_actions || "None documented"}`
          }
        ],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Letter generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("notification-letter error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
