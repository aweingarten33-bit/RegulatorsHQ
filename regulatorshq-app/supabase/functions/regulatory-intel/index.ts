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
    const { category, focus_areas } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: policies } = await supabase
      .from("policy_versions")
      .select("title, policy_id, status, content")
      .eq("status", "published")
      .order("version_number", { ascending: false })
      .limit(100);

    // Deduplicate to latest version per policy
    const seenPol = new Set<string>();
    const dedupedPolicies = (policies || []).filter((p: any) => { if (seenPol.has(p.policy_id)) return false; seenPol.add(p.policy_id); return true; });

    // Filter policies by focus areas if provided
    const focusKeywords: Record<string, string[]> = {
      compliance: ["compliance", "code of conduct", "conflict", "disclosure", "false claims", "anti-kickback", "stark", "reporting", "hotline", "investigation", "audit", "monitoring", "sanction", "exclusion", "oia", "clia"],
      privacy: ["privacy", "hipaa", "phi", "breach", "security", "access", "confidential", "authorization", "minimum necessary", "notice of privacy", "business associate", "baa"],
      billing: ["billing", "coding", "claims", "reimbursement", "medicare", "medicaid", "charge", "modifier", "drg", "cpt", "icd", "revenue cycle", "overpayment", "refund"],
      clinical: ["clinical", "patient", "care", "safety", "restraint", "infection", "medication", "informed consent", "advance directive", "emergency", "discharge", "treatment"],
      hr: ["employment", "harassment", "discrimination", "fmla", "ada", "worker", "compensation", "background check", "credentialing", "privileging", "labor"],
      research: ["research", "irb", "clinical trial", "informed consent", "human subjects", "protocol", "investigator"],
      pharmacy: ["pharmacy", "medication", "controlled substance", "formulary", "drug", "prescription", "dispensing", "340b"],
      it_security: ["cybersecurity", "information security", "access control", "encryption", "firewall", "incident response", "disaster recovery", "network", "endpoint"],
    };

    let filteredPolicies: any[] = dedupedPolicies;
    if (focus_areas && focus_areas.length > 0) {
      const keywords = focus_areas.flatMap((area: string) => focusKeywords[area] || []);
      if (keywords.length > 0) {
        filteredPolicies = filteredPolicies.filter((p: any) =>
          keywords.some((kw: string) => p.title.toLowerCase().includes(kw))
        );
      }
    }

    const policyList = filteredPolicies.map((p: any) => p.title).join(", ");
    const policyDetails = filteredPolicies.map((p: any) => {
      const content = p.content ? p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) : "";
      return `### ${p.title}\n${content || "No content available"}`;
    }).join("\n\n");
    const focusLabel = (focus_areas || []).join(", ") || "all compliance areas";

    const categoryQueries: Record<string, string> = {
      federal: `Latest healthcare regulatory changes from the federal register, CMS, OIG, and HHS rules in 2025-2026 affecting ${focusLabel}`,
      state: `Latest state healthcare regulatory changes and hospital compliance requirements in 2025-2026 affecting ${focusLabel}`,
      hcca: `HCCA Health Care Compliance Association latest updates, guidance, alerts, and enforcement actions in 2025-2026 related to ${focusLabel}`,
      oig: `OIG Office of Inspector General work plan updates, exclusions, advisory opinions, and fraud alerts for healthcare in 2025-2026 related to ${focusLabel}`,
      cms: `CMS Centers for Medicare & Medicaid Services conditions of participation, final rules, and hospital updates in 2025-2026 related to ${focusLabel}`,
      accreditation: `Joint Commission TJC and DNV GL healthcare accreditation standards updates and changes in 2025-2026 related to ${focusLabel}`,
    };

    const queryText = categoryQueries[category] || categoryQueries.federal;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content: `You are a healthcare regulatory intelligence analyst. The user is a compliance professional focused on: **${focusLabel}**.

ONLY surface regulatory changes that are RELEVANT to their focus areas. Do NOT include updates about unrelated departments or clinical specialties unless they have compliance/regulatory implications for the user's focus.

For each finding, provide:
1. A clear title
2. The source agency/organization
3. The date (be specific)
4. A 2-3 sentence summary of what changed
5. **Why This Matters to You**: Explain specifically why this is relevant to their focus area (${focusLabel})
6. **Action Required**: What the compliance team needs to DO about this
7. **Urgency**: 🔴 Immediate (deadline within 30 days), 🟡 Soon (30-90 days), 🟢 Monitor (90+ days or informational)
8. **Affected Policies**: Based on these existing organizational policies (with content summaries below), identify which ones might need updating and cite specific sections: ${policyList || "No policies in system yet"}

Format as markdown with clear sections. Include 5-8 findings MAX — quality over quantity. Skip anything not relevant to ${focusLabel}. Be SPECIFIC with dates, FR citations, and deadlines.

ORGANIZATION POLICY CONTENT (use to identify specific affected sections):
${policyDetails || "No policies available."}`,
          },
          {
            role: "user",
            content: queryText,
          },
        ],
        stream: false,
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
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "No results found.";

    return new Response(
      JSON.stringify({ content, citations: [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("regulatory-intel error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
