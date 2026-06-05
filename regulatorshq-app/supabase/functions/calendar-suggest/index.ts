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
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [{ data: calendar }, { data: policies }, { data: vendors }, { data: risks }] = await Promise.all([
      supabase.from("compliance_calendar").select("*").order("due_date"),
      supabase.from("policy_versions").select("title, policy_id, effective_date, status, content").eq("status", "published").order("version_number", { ascending: false }).limit(50),
      supabase.from("vendor_records").select("vendor_name, contract_end, exclusion_check_date, baa_signed_date").limit(50),
      supabase.from("risk_assessments").select("title, due_date, status").limit(30),
    ]);

    const existingItems = (calendar || []).map(c => `${c.title} (${c.category}, due: ${c.due_date}, status: ${c.status})`).join("\n");
    // Deduplicate policies and build rich context
    const seenPol = new Set<string>();
    const uniquePolicies = (policies || []).filter(p => { if (seenPol.has(p.policy_id)) return false; seenPol.add(p.policy_id); return true; });
    const policyList = uniquePolicies.map(p => {
      const snippet = p.content ? p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000) : "";
      return `- ${p.title} (effective: ${p.effective_date || 'N/A'})${snippet ? `\n  Content: ${snippet}` : ""}`;
    }).join("\n");
    const vendorList = (vendors || []).map(v => `${v.vendor_name} (contract end: ${v.contract_end || 'N/A'}, last exclusion: ${v.exclusion_check_date || 'never'})`).join("\n");

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
            content: `You are a healthcare compliance calendar expert. Use ONLY bullet points — no paragraphs or prose. Every suggestion = a bullet point with sub-bullets for details. Based on the organization's data, suggest critical compliance deadlines and activities they should add to their calendar.\n\nConsider:\n- Annual OIG exclusion screening requirements (monthly recommended)\n- Policy review cycles (annual minimum)\n- Training deadlines (annual compliance training, new hire orientation)\n- Regulatory filing deadlines (cost reports, Medicare enrollment, etc.)\n- BAA renewal dates\n- Vendor contract renewals\n- Risk assessment review cycles\n- Board/committee meeting schedules\n- CMS CoP survey preparation milestones\n- State licensure renewals\n- HIPAA risk assessment (annual)\n- Compliance program effectiveness review\n\nEXISTING CALENDAR ITEMS:\n${existingItems || "None"}\n\nPUBLISHED POLICIES:\n${policyList || "None"}\n\nVENDORS:\n${vendorList || "None"}\n\nFor each suggestion provide:\n1. **Title** of the calendar item\n2. **Category** (training, audit, reporting, review, filing, screening, meeting, general)\n3. **Suggested Due Date** (be specific — use actual dates within the next 12 months)\n4. **Recurrence** (one-time, monthly, quarterly, annually)\n5. **Why** — regulatory citation or best practice reference\n6. **Priority** — 🔴 Critical, 🟡 Important, 🟢 Recommended\n\nDon't duplicate items that already exist. Suggest at least 10-15 items.`,
          },
          { role: "user", content: "Analyze my compliance program data and suggest calendar items I'm missing. Today's date is " + new Date().toISOString().split("T")[0] },
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
    console.error("calendar-suggest error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
