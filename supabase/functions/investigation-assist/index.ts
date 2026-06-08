import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
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
    const body = await req.json();
    const { mode } = body;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Fetch org context — pull full policy content for grounded citations
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: policies } = await sb.from("policy_versions").select("title, content, status").eq("status", "published").order("version_number", { ascending: false }).limit(30);
    const seen = new Set<string>();
    const polList = (policies ?? []).filter(p => { if (seen.has(p.title)) return false; seen.add(p.title); return true; });
    
    // Build rich policy context with content snippets
    let policyContext = "";
    if (polList.length) {
      const policyDetails = polList.map(p => {
        const content = p.content ? p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) : "No content available";
        return `### ${p.title}\n${content}`;
      }).join("\n\n");
      policyContext = `\n\nOrganization Policies (use these to cite specific sections and requirements):\n\n${policyDetails}`;
    }

    let systemPrompt = "";
    let userMessage = "";

    if (mode === "generate_letter") {
      const { letterType, caseDetails } = body;
      systemPrompt = `You are an expert healthcare compliance officer and employment law advisor. Generate a professional, ready-to-use determination/notification letter based on the case details provided.

Letter type requested: ${letterType}

The letter must:
- Be formatted as a formal business memo/letter
- Include all necessary legal language and disclaimers
- Reference specific policies, regulations, and CFR sections where applicable
- Be professional, clear, and legally defensible
- Include placeholders like [Employee Name], [Date], [Case Number] where specific info isn't provided
- Follow progressive discipline best practices for healthcare compliance

Available letter types and their purposes:
- "verbal_counseling": Level 1 — coaching memo for first-time minor violations
- "written_warning": Level 2 — formal written warning for repeat or moderate violations
- "final_warning": Level 3 — final warning with suspension for serious violations
- "termination": Level 4 — termination letter for willful/serious violations
- "not_substantiated": Closure letter when allegation was not proven
- "unfounded": Closure letter when evidence disproves the allegation
- "inconclusive": Closure letter when evidence is genuinely split
- "exoneration": Letter clearing the subject of all allegations
- "reporter_update": Status update letter to the person who reported the concern
- "regulatory_disclosure": Self-disclosure letter template for OIG/OCR

${policyContext}

Generate the complete letter now. Make it specific to the case details provided.`;

      userMessage = `Generate a "${letterType}" letter for this case:\n\n${caseDetails}`;

    } else if (mode === "case_analysis") {
      const { caseFacts } = body;

      // Use Lovable AI for research-grounded case analysis
      const synthesisPrompt = `You are a senior healthcare compliance investigator. Analyze the case facts and provide expert regulatory analysis.

CRITICAL: Be CONCISE. Use bullet points, not paragraphs. Each section should be 3-5 bullet points MAX. No filler, no preamble, no restating the facts back. Get straight to the analysis.

Keep the TOTAL response under 600 words.

## Root Cause
- 1-2 sentences on the primary root cause
- System vs. individual failure

## Regulations
- List applicable CFR sections (one line each)
- Current penalty range
- Reporting deadlines if any

## Risk Level: [Critical/High/Medium/Low]
- One line each: regulatory, financial, reputational, patient safety

## Investigation Steps
- Numbered list of what to do, in order (max 6 steps)
- Include who to interview and what evidence to pull

## Corrective Actions
- Immediate (24-72 hrs): 1-2 items
- Short-term (30 days): 1-2 items
- Long-term: 1-2 items

## Determination
- Recommended finding + disciplinary level in 1-2 sentences
- Self-disclosure needed? Yes/No with one line rationale

${policyContext}`;

      const geminiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: synthesisPrompt },
            { role: "user", content: `## Case Facts\n${caseFacts}` },
          ],
          stream: true,
          temperature: 0,
        }),
      });

      if (!geminiResponse.ok) {
        if (geminiResponse.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (geminiResponse.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const t = await geminiResponse.text();
        console.error("AI error:", geminiResponse.status, t);
        return new Response(JSON.stringify({ error: "AI service error" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(geminiResponse.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });


    } else if (mode === "intake_copilot") {
      const { message: userMsg, caseContext } = body;
      systemPrompt = `You are an AI intake assistant for healthcare compliance investigators creating new cases. You help them categorize, prioritize, and plan investigations.

You have the current case intake form data:
${caseContext || "No form data yet."}

${policyContext}

Be concise (3-5 bullet points max). Give specific, actionable advice. Reference relevant regulations (CFR sections, OIG guidance) when applicable.`;
      userMessage = userMsg || "Help me with this case intake.";

    } else if (mode === "playbook") {
      const { caseType, severity: caseSeverity, caseDetails: details } = body;
      systemPrompt = `You are a senior healthcare compliance investigator. Generate a complete, actionable Investigation Playbook for the case described.

Case Type: ${caseType || "Unknown"}
Severity: ${caseSeverity || "Medium"}

The playbook MUST include these sections:
1. **Initial Assessment** — Key risk factors and urgency classification
2. **Evidence Preservation** — Documents, systems, and records to secure immediately (be specific)
3. **Interview Plan** — Recommended interview order with 3-5 specific questions per person
4. **Document Review Checklist** — Specific policies, logs, and records to examine
5. **Regulatory References** — Applicable CFR sections, OIG guidance, state requirements
6. **Investigation Timeline** — Step-by-step with estimated durations (Day 1, Week 1, Week 2, etc.)
7. **Escalation Triggers** — Conditions that require immediate escalation
8. **Corrective Action Framework** — Suggested actions for likely outcomes (substantiated vs. unsubstantiated)

Use checkboxes (- [ ]) for actionable items. Be specific to the case type.
${policyContext}`;
      userMessage = `Generate an investigation playbook for this case:\n\n${details}`;

    } else if (mode === "regulatory_advisor") {
      const { caseDetails: details } = body;

      systemPrompt = `You are a healthcare regulatory filing advisor. Analyze the case and identify ALL regulatory filing obligations.

For EACH obligation, provide:
1. **Agency** — Which body must be notified (OIG, CMS, OCR, OSHA, EEOC, state health dept, law enforcement, etc.)
2. **Deadline** — Specific filing deadline (e.g., "60 days from discovery" or "72 hours")
3. **Regulatory Basis** — The specific law/regulation requiring the filing
4. **Penalty for Non-Filing** — What happens if you miss the deadline
5. **Filing Template** — A pre-filled disclosure template with placeholders

End with a **Priority Matrix** ranking obligations by deadline urgency.

Flag any deadlines that may already be approaching.
${policyContext}`;

      userMessage = `## Case Details\n${details}`;

      // Stream the response directly
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          stream: true,
          temperature: 0,
        }),
      });

      if (!aiResp.ok) {
        if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: "AI error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(aiResp.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });

    } else {
      // Legacy modes: next_steps / summary
      const { investigation } = body;
      const invDetails = `Case: ${investigation?.case_number || "N/A"}
Title: ${investigation?.title || "N/A"}
Status: ${investigation?.status || "N/A"}
Category: ${investigation?.category || "N/A"}
Priority: ${investigation?.priority || "N/A"}
Source: ${investigation?.source || "N/A"}
Description: ${investigation?.description || "No description provided"}
Assigned To: ${investigation?.assigned_to || "Unassigned"}
Reported By: ${investigation?.reported_by || "Unknown"}`;

      if (mode === "summary") {
        systemPrompt = `You are a healthcare compliance investigation report writer. Use ONLY bullet points — no paragraphs or prose. Every finding = a bullet point with sub-bullets for details. Generate a professional investigation summary suitable for board reporting, legal counsel, and regulatory filing.\n\n${policyContext}`;
      } else {
        systemPrompt = `You are a healthcare compliance investigation advisor. Use ONLY bullet points — no paragraphs. Every recommendation = a bullet point. Provide specific, actionable next steps for this investigation.\n\n${policyContext}`;
      }
      userMessage = `Analyze this investigation:\n\n${invDetails}`;
    }

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
          { role: "user", content: userMessage },
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
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings → Workspace → Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("investigation-assist error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
