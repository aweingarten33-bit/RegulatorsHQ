import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchRelatedPolicies(currentTitle: string): Promise<string> {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: versions } = await sb.from("policy_versions").select("policy_id, title, status, version_number, content").eq("status", "published").order("version_number", { ascending: false });
  const seen = new Set<string>();
  const policies: any[] = [];
  for (const v of versions ?? []) { if (!seen.has(v.policy_id) && v.title !== currentTitle) { seen.add(v.policy_id); policies.push(v); } }
  if (policies.length === 0) return "";
  const details = policies.map(p => { const content = p.content ? p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) : "No content"; return `### "${p.title}" (v${p.version_number}, ${p.status})\n${content}`; }).join("\n\n");
  return "\n\n## OTHER POLICIES IN THIS ORGANIZATION (use to identify relationships and cross-references)\n" + details + "\n\nWhen summarizing, note any relationships or dependencies with these existing policies.";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { policyTitle, policyContent, mode } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let orgContext = "";
    try { orgContext = await fetchRelatedPolicies(policyTitle || ""); } catch (e) { console.error("Context fetch failed:", e); }

    const systemPrompts: Record<string, string> = {
      summarize: `You are a policy summarization assistant. Given a policy title and content, produce a concise, plain-language summary that highlights:\n- Purpose and scope\n- Key requirements and obligations\n- Important deadlines or review dates\n- Who it applies to\n- Any relevant regulatory context from current compliance standards\n- Relationships to other organizational policies (if applicable)\n${orgContext}\nKeep it under 200 words. Use bullet points for clarity.`,
      compare: `You are a policy change analyst. Given two versions of a policy, produce a clear comparison that highlights:\n- What was added\n- What was removed\n- What was modified\n- Impact assessment of changes\n- Any relevant regulatory updates that may affect the changes\n- Impact on related organizational policies\n${orgContext}\nUse markdown formatting with clear sections.`,
    };

    const userContent = mode === "compare"
      ? `Compare these policy versions:\n\nCurrent: ${policyContent}\n\nPrevious: ${policyTitle}`
      : `Summarize this policy:\n\nTitle: ${policyTitle}\n\nContent: ${policyContent || "This policy covers standard organizational requirements for " + policyTitle + "."}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "system", content: systemPrompts[mode] || systemPrompts.summarize }, { role: "user", content: userContent }],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI service error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("policy-summarize error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
