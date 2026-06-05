import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchOrgContext(): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);

  const { data: versions } = await sb
    .from("policy_versions")
    .select("policy_id, title, status, version_number, content, effective_date")
    .order("version_number", { ascending: false });

  const latestByPolicy = new Map<string, typeof versions extends (infer T)[] ? T : never>();
  for (const v of versions ?? []) {
    if (!latestByPolicy.has(v.policy_id)) {
      latestByPolicy.set(v.policy_id, v);
    }
  }
  const policies = Array.from(latestByPolicy.values());

  const { data: manuals } = await sb
    .from("manuals")
    .select("id, title, description, status");

  const { data: chapters } = await sb
    .from("manual_chapters")
    .select("id, manual_id, title, sort_order");

  const { data: chapterPolicies } = await sb
    .from("manual_chapter_policies")
    .select("chapter_id, policy_id, sort_order");

  let manualContext = "";
  if (manuals?.length) {
    manualContext = "\n\n## MANUALS\n";
    for (const m of manuals) {
      manualContext += `\n### Manual: "${m.title}" (Status: ${m.status})\n`;
      if (m.description) manualContext += `Description: ${m.description}\n`;
      const mChapters = (chapters ?? [])
        .filter((c) => c.manual_id === m.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      for (const ch of mChapters) {
        const cpIds = (chapterPolicies ?? [])
          .filter((cp) => cp.chapter_id === ch.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((cp) => cp.policy_id);
        const policyTitles = cpIds
          .map((pid) => latestByPolicy.get(pid)?.title)
          .filter(Boolean);
        manualContext += `  - Chapter ${ch.sort_order}: "${ch.title}" → Policies: ${policyTitles.length ? policyTitles.join(", ") : "(none)"}\n`;
      }
    }
  }

  let policyContext = "## POLICIES IN THE SYSTEM\n";
  if (policies.length === 0) {
    policyContext += "(No policies have been created yet)\n";
  } else {
    for (const p of policies) {
      policyContext += `\n### "${p.title}" (v${p.version_number}, Status: ${p.status})`;
      if (p.effective_date) policyContext += ` — Effective: ${p.effective_date}`;
      policyContext += "\n";
      if (p.content) {
        const snippet = p.content.replace(/<[^>]*>/g, "").replace(/\s+/g, ' ').trim().slice(0, 1500);
        policyContext += `Content preview: ${snippet}...\n`;
      }
    }
  }

  return policyContext + manualContext;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Fetch live org data
    let orgContext = "";
    try {
      orgContext = await fetchOrgContext();
    } catch (e) {
      console.error("Failed to fetch org context:", e);
      orgContext = "(Unable to load organization data at this time)";
    }

    const systemPrompt = `You are AssistantIQ, a compliance assistant for RegulatorsHQ — a healthcare compliance platform.\n\nVOICE: You're a smart colleague texting back a helpful answer. Warm, brief, no filler.\n\nOUTPUT FORMAT — MANDATORY:\n1. One short friendly opening sentence\n2. Then ONLY markdown bullets using "- " — NEVER paragraphs\n3. Bold **policy names** and **key terms**  \n4. Each bullet = 1 sentence max\n5. Maximum 6 bullets total — pick the most important ones\n6. End with a confidence indicator\n\nHARD LIMITS:\n- 150 words max for simple questions, 250 for analysis\n- Never start with "Great question!" or "Certainly!" — vary your openings\n- No repeating the question back\n- No filler ("It's important to note", "Let me provide a comprehensive overview")\n- If you catch yourself at 6+ bullets, cut the weakest ones\n\nLIVE ORGANIZATIONAL DATA:\n${orgContext}\n\nCONTENT RULES:\n- Answer from ACTUAL policy/manual data above — this is real, live data\n- If asked about a policy, reference its title, version, and status\n- If data doesn't have it, say so honestly\n- Bold all **policy names**\n- Plain language, no legal jargon unless quoting\n\nCONFIDENCE (always end with one):\n✅ **High confidence** — directly in organizational policy\n⚠️ **Medium confidence** — partially covered or general compliance knowledge  \n❓ **Low confidence** — not clearly covered, verify recommended`;

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
          ...messages,
        ],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("compliance-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
