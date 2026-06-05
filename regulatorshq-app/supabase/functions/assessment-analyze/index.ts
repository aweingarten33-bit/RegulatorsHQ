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
    const { answers } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{ data: policies }, { data: risks }, { data: training }, { data: investigations }, { data: hotline }, { data: vendors }] = await Promise.all([
      supabase.from("policy_versions").select("title, status, content, policy_id").eq("status", "published").order("version_number", { ascending: false }).limit(50),
      supabase.from("risk_assessments").select("title, status, risk_level").limit(30),
      supabase.from("training_records").select("completion_status").limit(200),
      supabase.from("investigations").select("status, category").limit(30),
      supabase.from("hotline_reports").select("status, category").limit(30),
      supabase.from("vendor_records").select("vendor_name, baa_required, baa_signed, exclusion_check_date").limit(30),
    ]);

    // Build rich policy context
    const seenPol = new Set<string>();
    const uniquePolicies = (policies || []).filter(p => { if (seenPol.has(p.policy_id)) return false; seenPol.add(p.policy_id); return true; });
    const policyDetails = uniquePolicies.map(p => {
      const content = p.content ? p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) : "No content";
      return `### ${p.title}\n${content}`;
    }).join("\n\n");

    const orgData = {
      policies: { total: uniquePolicies.length, published: uniquePolicies.length, details: policyDetails },
      risks: { total: (risks || []).length, open: (risks || []).filter(r => r.status === "open").length, high: (risks || []).filter(r => r.risk_level === "high" || r.risk_level === "critical").length },
      training: {
        total: (training || []).length,
        completed: (training || []).filter(t => t.completion_status === "completed").length,
        overdue: (training || []).filter(t => t.completion_status !== "completed").length,
      },
      investigations: { total: (investigations || []).length, open: (investigations || []).filter(i => i.status === "open" || i.status === "in_progress").length },
      hotline: { total: (hotline || []).length },
      vendors: {
        total: (vendors || []).length,
        baaGaps: (vendors || []).filter(v => v.baa_required && !v.baa_signed).length,
        exclusionOverdue: (vendors || []).filter(v => !v.exclusion_check_date).length,
      },
    };

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
            content: `You are an expert healthcare compliance program evaluator performing a comprehensive OIG 7 Elements assessment. Use ONLY bullet points — no paragraphs or flowing prose. Every finding, gap, and recommendation = a bullet point with sub-bullets for details.\n\nSELF-ASSESSMENT ANSWERS (from the compliance officer):\n${JSON.stringify(answers, null, 2)}\n\nLIVE ORGANIZATIONAL DATA:\n${JSON.stringify(orgData, null, 2)}\n\nProvide a comprehensive gap analysis including:\n\n1. **Executive Summary** — overall program maturity rating (Nascent / Developing / Established / Advanced)\n2. **Element-by-Element Analysis** — for each of the 7 OIG elements:\n   - Current status based on answers AND live data\n   - Specific gaps identified\n   - Risk level (🔴 Critical / 🟡 Moderate / 🟢 Low)\n   - Recommended corrective actions with deadlines\n3. **Data-Driven Insights** — what the live system data reveals that the self-assessment might miss:\n   - Training completion rates vs. requirements\n   - Policy coverage gaps\n   - Open risk items without mitigation\n   - Vendor compliance gaps\n   - Investigation/hotline trends\n4. **Prioritized Action Plan** — top 10 actions ranked by risk/impact\n5. **DOJ Evaluation Criteria** — how this program would be evaluated under the DOJ's Evaluation of Corporate Compliance Programs\n6. **Board Presentation Summary** — 3-4 bullet points for the Board of Directors\n7. **Benchmarking** — how this compares to typical healthcare compliance programs\n\nBe specific, cite regulations, and provide actionable timelines.`,
          },
          { role: "user", content: "Perform the comprehensive gap analysis based on our self-assessment and live data." },
        ],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "Credits required" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error: ${response.status}`);
    }

    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("assessment-analyze error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
