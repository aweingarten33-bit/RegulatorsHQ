import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchDashboardStats() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);

  const [policiesRes, calendarRes, attestationsRes] = await Promise.all([
    sb.from("policy_versions").select("policy_id, title, status, version_number, effective_date").order("version_number", { ascending: false }),
    sb.from("compliance_calendar").select("id, title, due_date, status, category"),
    sb.from("attestation_records").select("id, status, policy_id"),
  ]);

  const latestPolicies = new Map();
  for (const v of policiesRes.data ?? []) {
    if (!latestPolicies.has(v.policy_id)) latestPolicies.set(v.policy_id, v);
  }
  const policies = Array.from(latestPolicies.values());
  const calendarItems = calendarRes.data ?? [];
  const attestations = attestationsRes.data ?? [];
  const today = new Date().toISOString().split("T")[0];

  return {
    totalPolicies: policies.length,
    policiesByStatus: {
      published: policies.filter(p => p.status === "published").length,
      draft: policies.filter(p => p.status === "draft").length,
      in_review: policies.filter(p => p.status === "in_review" || p.status === "pending").length,
    },
    upcomingDeadlines: calendarItems.filter(c => c.due_date >= today && c.status !== "completed").sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5),
    overdueDeadlines: calendarItems.filter(c => c.due_date < today && c.status !== "completed").length,
    pendingAttestations: attestations.filter(a => a.status === "pending" || a.status === "sent").length,
    completedAttestations: attestations.filter(a => a.status === "completed" || a.status === "signed").length,
    totalAttestations: attestations.length,
  };
}

function getRoleBriefingInstructions(userRole: string): string {
  switch (userRole) {
    case "admin":
      return `\nROLE-SPECIFIC FOCUS (Administrator / Compliance Officer):\n- Highlight system-wide compliance health: policy coverage, attestation completion rates, overdue items\n- Flag any gaps in policy lifecycle (drafts stalled, reviews overdue)\n- Mention calendar deadlines that affect the entire organization\n- Suggest proactive actions: schedule reviews, send attestation reminders, check approval queues\n- Tone: authoritative, strategic, action-oriented`;
    case "editor":
      return `\nROLE-SPECIFIC FOCUS (Manager / Department Lead):\n- Focus on policies in the approval workflow that need their attention\n- Highlight team attestation completion and any gaps\n- Surface upcoming deadlines relevant to their department\n- Mention any policies currently in review that may need their input\n- Tone: collaborative, team-focused, practical`;
    default:
      return `\nROLE-SPECIFIC FOCUS (General Staff / Employee):\n- Keep it simple and personal — focus only on what affects THIS employee\n- Highlight any policies they need to read, sign, or attest to\n- Mention any approval steps waiting on them\n- Remind them of upcoming training or attestation deadlines\n- Do NOT mention system-wide stats or admin concerns\n- Tone: friendly, clear, non-technical, supportive`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const { mode, userName, userRole, userDepartment } = body;
    const stats = await fetchDashboardStats();

    if (mode === "stats") {
      return new Response(JSON.stringify(stats), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    if (mode === "tip") {
      const tipResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: `You are a healthcare compliance expert. Generate ONE short, interesting "Did You Know?" compliance fact. It must be accurate, educational, and surprising. Topics: HIPAA, OIG, CMS, False Claims Act, Anti-Kickback, Stark Law, accreditation, patient rights, breach notification, exclusion screening, etc. Keep it to ONE sentence, max 120 characters. Do NOT include "Did you know" prefix — just the fact itself. Vary topics each time.` },
            { role: "user", content: `Generate a compliance tip. Today: ${new Date().toISOString().slice(0, 10)}. Random seed: ${Math.random()}` },
          ],
          temperature: 0,
        }),
      });
      if (!tipResp.ok) throw new Error("Tip generation failed");
      const tipData = await tipResp.json();
      const tip = tipData.choices?.[0]?.message?.content?.trim() || "HIPAA requires breach notification within 60 days of discovery.";
      return new Response(JSON.stringify({ tip }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (mode === "radar") {
      const radarResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: "You are a healthcare compliance regulatory monitor. Return ONLY a single headline (max 120 characters) about an important recent regulatory development specifically affecting healthcare compliance programs. Focus ONLY on: OIG enforcement actions, False Claims Act settlements, Anti-Kickback Statute updates, Stark Law changes, HIPAA enforcement, CMS Conditions of Participation, compliance program guidance, corporate integrity agreements, exclusion actions, or healthcare fraud prosecutions. Do NOT include clinical, pharmaceutical, or general business news. Return ONLY the headline text — no quotes, no prefix, no explanation." },
            { role: "user", content: `What is an important healthcare compliance regulatory development? Today is ${new Date().toISOString().slice(0, 10)}.` },
          ],
          temperature: 0,
        }),
      });
      let headline = "New regulatory updates available — check Regulatory Intel.";
      if (radarResp.ok) {
        const radarData = await radarResp.json();
        headline = radarData.choices?.[0]?.message?.content?.trim() || headline;
      }
      return new Response(JSON.stringify({ headline, url: null }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const roleInstructions = getRoleBriefingInstructions(userRole || "viewer");
    const userContext = userName
      ? `\nUSER CONTEXT: This briefing is for ${userName}${userRole ? ` (role: ${userRole})` : ""}${userDepartment ? `, ${userDepartment} department` : ""}. Address them by first name and tailor the briefing to their role.`
      : "";

    const systemPrompt = `You are the PolicyIQ Daily Briefing AI. Generate a concise, actionable compliance briefing for today (${today}).\n${userContext}\n${roleInstructions}\n\nHere are the LIVE stats from the organization's compliance system:\n\nPOLICIES: ${stats.totalPolicies} total (${stats.policiesByStatus.published} published, ${stats.policiesByStatus.draft} draft, ${stats.policiesByStatus.in_review} in review)\nCOMPLIANCE CALENDAR: ${stats.overdueDeadlines} overdue deadlines, ${stats.upcomingDeadlines.length} upcoming\nATTESTATIONS: ${stats.pendingAttestations} pending, ${stats.completedAttestations} completed of ${stats.totalAttestations} total\n\nUPCOMING DEADLINES:\n${stats.upcomingDeadlines.map(d => `- ${d.title}: due ${d.due_date} (${d.category})`).join("\n") || "(none)"}\n\nRULES:\n- Start with a personalized one-sentence greeting using the user's first name (if provided) and an overall compliance health summary\n- Then give 3-5 bullet points of the most important things to focus on TODAY\n- Focus on policies, attestations, deadlines, and document review items\n- Use plain language, be specific, reference actual numbers\n- Flag anything urgent (overdue deadlines, pending attestations)\n- End with one brief forward-looking note about what's coming up\n- Keep the entire briefing under 200 words\n- Use emojis sparingly for visual scanning (🔴 urgent, 🟡 attention, 🟢 good)\n- Format each bullet as a proper markdown list item starting with "- " on its own line\n- Do NOT combine multiple bullets into a single paragraph — each must be a separate line\n- Do NOT mention vendors, vendor management, BAAs, or any vendor-related topics\n- This briefing is visible to the ENTIRE organization — do NOT mention investigations, hotline reports, case details, or any sensitive/confidential compliance matters`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate today's compliance briefing." },
        ],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI service error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("dashboard-briefing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
