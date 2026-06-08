import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchOrgContext(): Promise<string> {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: versions } = await sb.from("policy_versions").select("policy_id, title, status, version_number, content").order("version_number", { ascending: false });
  const seen = new Map<string, any>();
  for (const v of versions ?? []) { if (!seen.has(v.policy_id)) seen.set(v.policy_id, v); }
  const policies = Array.from(seen.values());
  let context = "## EXISTING ORGANIZATIONAL POLICIES\n";
  if (policies.length === 0) { context += "(No policies in the system yet)\n"; }
  else {
    for (const p of policies) {
      context += `- "${p.title}" (v${p.version_number}, ${p.status})`;
      if (p.content) { const snippet = p.content.replace(/<[^>]*>/g, "").replace(/\s+/g, ' ').trim().slice(0, 1500); context += `: ${snippet}...`; }
      context += "\n";
    }
  }
  const { data: standards } = await sb.from("standards_library").select("accrediting_body, chapter_name, standard_code").limit(50);
  if (standards?.length) {
    const bodies = [...new Set(standards.map(s => s.accrediting_body))];
    context += "\n## ACCREDITING BODIES & STANDARDS TRACKED\n" + bodies.join(", ") + "\n";
  }
  return context;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { documentText, fileName, standards, accreditations, standardsHint } = await req.json();
    if (!documentText || typeof documentText !== "string") {
      return new Response(JSON.stringify({ error: "documentText is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let orgContext = "";
    try { orgContext = await fetchOrgContext(); } catch (e) { console.error("Context fetch failed:", e); }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content: `You are a healthcare compliance policy editor.\n\nReview the provided document and improve it without changing its core meaning unless necessary for clarity or compliance.\n\nYour job is to:\n- Improve clarity and readability\n- Eliminate ambiguity\n- Strengthen enforceability\n- Remove redundancy\n- Ensure consistent terminology\n- Flag unclear or legally risky language\n\nMaintain the original intent and organizational tone.\nDo not rewrite unnecessarily.\nIf structural changes are needed, explain why briefly before suggesting revisions.\n\nHere is context about this organization's existing policies and compliance program:\n\n${orgContext}\n\nWhen reviewing documents:\n- Check for consistency with existing organizational policies listed above\n- Flag any contradictions between this document and existing policies\n- Note where this document should cross-reference existing policies\n- Identify gaps where the organization has no existing policy coverage\n\nSTRICT RULES — follow these without exception:\n- ONLY analyze what is actually written in the document. Never invent content, clauses, or provisions that are not present.\n- When quoting or referencing the document, use exact phrases from the text in quotation marks.\n- If a section is missing or unclear, explicitly say so — do not fill in gaps with assumptions.\n- Clearly distinguish between: (a) what the document explicitly states, (b) what is generally required by compliance frameworks, and (c) what is missing.\n- Label any general compliance knowledge with: "⚠️ General best practice — not found in this document."\n\nCRITICAL FORMATTING RULES:\n- Use ONLY bullet points and sub-bullets — NO paragraphs or flowing prose\n- Every finding, observation, and recommendation must be a bullet point\n- Use indented sub-bullets for details, quotes, and explanations\n- Use bold for key terms and quoted text from the document\n- Keep each bullet to 1-2 lines max\n- Use section headers (##) to organize, but ALL content under headers must be bullets\n\nStructure your review as follows:\n\n## Document Overview\n- Document type: [type]\n- Apparent scope: [scope]\n- Key topics covered: [list]\n\n## Clarity & Readability Assessment\n- Issues found with ambiguous language\n- Redundancies flagged\n- Terminology inconsistencies\n\n## Enforceability Review\n- ✅ **Strong**: [enforceable provisions]\n- ⚠️ **Weak**: [vague or unenforceable language] — suggested revision\n- ❌ **Missing**: [required provisions not present]\n\n## Consistency with Existing Policies\n- ✅ **Aligns with**: [policy name] — [how]\n- ⚠️ **Contradicts**: [policy name] — [how]\n- ❌ **Missing cross-reference to**: [policy name] — [why needed]\n\n## Compliance Assessment${standardsHint ? ` — FOCUS: ${standardsHint}` : (standards && standards.length > 0) ? ` — FOCUS: ${standards.join(", ")}` : ""}\nFor each framework:\n- ✅ **Addressed**: [provision] — "[quoted text from document]"\n- ❌ **Missing**: [required provision] — [regulatory basis]\n- ⚠️ **Partial**: [provision] — [what's there vs. what's needed]\n\n## Risk Areas\n- 🔴 **HIGH**: [risk] — "[problematic text or absence]"\n- 🟡 **MEDIUM**: [risk]\n- 🟢 **LOW**: [risk]\n\n## Suggested Revisions (Priority Order)\n- 🔴 [Specific edit] — [why this change strengthens the document]\n- 🟡 [Specific edit]\n- 🟢 [Specific edit]\n\n## Overall Assessment\n- **Score**: X/10\n- **Justification**: [1-2 bullet points]\n- **Confidence**: [High/Medium/Low] — [why]\n- ⚖️ *This is an automated review. All findings should be verified by your legal and compliance teams.*`,
          },
          {
            role: "user",
            content: `Please review the following document${fileName ? ` (${fileName})` : ""}${standardsHint ? `\n\nFocus compliance review on these standards/accreditations: ${standardsHint}` : (standards && standards.length > 0) ? `\n\nFocus compliance review on these standards: ${standards.join(", ")}` : ""}${(accreditations && accreditations.length > 0) ? `\n\nAlso evaluate against these accreditation bodies and their requirements: ${accreditations.join(", ")}` : ""}:\n\n${documentText}`,
          },
        ],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI service error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("document-review error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
