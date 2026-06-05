import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { policyId, standardHint } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY not configured");

    const sb = createClient(supabaseUrl, supabaseKey);

    const { data: policyVersion, error: pvErr } = await sb
      .from("policy_versions")
      .select("*")
      .eq("policy_id", policyId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    if (pvErr || !policyVersion) throw new Error("Policy not found");

    const { data: allVersions } = await sb
      .from("policy_versions")
      .select("policy_id, title, status")
      .eq("status", "published")
      .order("version_number", { ascending: false });

    const seen = new Set<string>();
    const otherPolicies: string[] = [];
    for (const v of allVersions ?? []) {
      if (!seen.has(v.policy_id) && v.policy_id !== policyId) {
        seen.add(v.policy_id);
        otherPolicies.push(v.title);
      }
    }

    const { data: standards } = await sb.from("standards_library").select("accrediting_body, chapter_name, standard_code, standard_text").limit(30);

    const policyTitle = policyVersion.title;
    const policyContent = policyVersion.content || "No content available";

    let orgContext = "";
    if (otherPolicies.length > 0) orgContext += `\n\n## OTHER POLICIES IN THIS ORGANIZATION\n${otherPolicies.map(t => `- ${t}`).join("\n")}`;
    if (standards?.length) {
      const bodies = [...new Set(standards.map(s => s.accrediting_body))];
      orgContext += `\n\n## ACCREDITING BODIES TRACKED\n${bodies.join(", ")}`;
    }

    const analysisRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content: `You are an expert healthcare compliance policy analyst performing a gap analysis.\n\nCONTEXT ABOUT THIS ORGANIZATION:\n${orgContext}\n\nANALYSIS REQUIREMENTS:\n1. Compare against current federal/state regulatory requirements\n2. Evaluate against industry best practices and OIG guidance\n3. Check for completeness of standard policy elements\n4. Assess cross-references to other organizational policies\n5. If specific standards are mentioned, focus there\n\nCRITICAL FORMATTING — BULLET POINTS ONLY:\n- Use ONLY bullet points and sub-bullets — NO paragraphs\n- Every finding must be a bullet point\n- Use bold for key terms and regulation names\n- Keep each bullet to 1-2 lines max\n- Use ## section headers, but ALL content must be bullets\n\nREQUIRED OUTPUT STRUCTURE:\n\n## Compliance Score\n- **Overall Score**: X/10\n- **Clarity**: X/10\n- **Enforceability**: X/10\n- **Completeness**: X/10\n- **Consistency**: X/10\n\n## Executive Summary\n- Overall compliance posture: [Good/Fair/Poor]\n- Critical gaps found: [count]\n- Highest-risk area: [area]\n- Most urgent action: [action]\n\n## Critical Gaps\nFor each gap:\n- ❌ **[Gap title]**\n  - Missing: [specific requirement]\n  - Regulatory basis: **[law/regulation]** — [citation]\n  - Risk: 🔴 High / 🟡 Medium / 🟢 Low\n  - Fix: [recommended change]\n\n## Outdated Language\n- ⚠️ **[Section]** — references [old requirement]\n  - Should say: [current requirement]\n\n## Consistency with Other Policies\n- ✅ **Aligns with**: [policy name] — [how]\n- ⚠️ **Missing cross-reference to**: [policy name] — [why needed]\n- ❌ **Contradicts**: [policy name] — [how]\n\n## Strengths\n- ✅ **[Strength]** — [why, what regulation it satisfies]\n\n## Recommended Updates (Priority Order)\n- 🔴 **P1**: [Change] — [basis]\n- 🟡 **P2**: [Change] — [basis]\n- 🟢 **P3**: [Change] — [basis]\n\nDo NOT fabricate citations. Note when uncertain.`,
          },
          {
            role: "user",
            content: `## Policy: ${policyTitle}\n${standardHint ? `\n## Focus Area: ${standardHint}` : ""}\n\n## Policy Content:\n${policyContent.substring(0, 15000)}`,
          },
        ],
        temperature: 0,
      }),
    });

    if (!analysisRes.ok) {
      if (analysisRes.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (analysisRes.status === 402) return new Response(JSON.stringify({ error: "AI usage limit reached." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await analysisRes.text();
      console.error("AI gateway error:", analysisRes.status, t);
      throw new Error("AI service error");
    }

    const analysisData = await analysisRes.json();
    const analysis = analysisData.choices?.[0]?.message?.content || "Analysis could not be generated.";

    let score = null;
    const overallMatch = analysis.match(/\*\*Overall Score\*\*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
    const clarityMatch = analysis.match(/\*\*Clarity\*\*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
    const enforceabilityMatch = analysis.match(/\*\*Enforceability\*\*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
    const completenessMatch = analysis.match(/\*\*Completeness\*\*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
    const consistencyMatch = analysis.match(/\*\*Consistency\*\*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);

    if (overallMatch) {
      score = {
        overall: parseFloat(overallMatch[1]),
        clarity: clarityMatch ? parseFloat(clarityMatch[1]) : parseFloat(overallMatch[1]),
        enforceability: enforceabilityMatch ? parseFloat(enforceabilityMatch[1]) : parseFloat(overallMatch[1]),
        completeness: completenessMatch ? parseFloat(completenessMatch[1]) : parseFloat(overallMatch[1]),
        consistency: consistencyMatch ? parseFloat(consistencyMatch[1]) : parseFloat(overallMatch[1]),
      };
    }

    return new Response(JSON.stringify({ analysis, citations: [], score }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("Gap analysis error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
