import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Get all active staff with departments
    const { data: staff, error: staffErr } = await supabase
      .from("staff_directory")
      .select("id, full_name, email, department")
      .eq("is_active", true);

    if (staffErr) throw staffErr;
    if (!staff || staff.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No active staff found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get all manuals with chapters and their policies
    const { data: manuals } = await supabase.from("manuals").select("id, title, category");
    const { data: chapters } = await supabase.from("manual_chapters").select("id, manual_id, title");
    const { data: chapterPolicies } = await supabase.from("manual_chapter_policies").select("chapter_id, policy_id");
    const { data: policyVersions } = await supabase
      .from("policy_versions")
      .select("policy_id, title, content, category")
      .not("content", "is", null);

    // Build department -> policies mapping
    const deptPolicies: Record<string, { policy_id: string; title: string; content: string }[]> = {};

    for (const manual of manuals || []) {
      const manualChapters = (chapters || []).filter(c => c.manual_id === manual.id);
      const policyIds = new Set<string>();
      for (const ch of manualChapters) {
        for (const cp of (chapterPolicies || []).filter(cp => cp.chapter_id === ch.id)) {
          policyIds.add(cp.policy_id);
        }
      }

      const policies = (policyVersions || [])
        .filter(pv => policyIds.has(pv.policy_id))
        .map(pv => ({ policy_id: pv.policy_id, title: pv.title, content: pv.content || "" }));

      const keys = [manual.category, manual.title].filter(Boolean).map(k => k!.toLowerCase());
      for (const key of keys) {
        if (!deptPolicies[key]) deptPolicies[key] = [];
        deptPolicies[key].push(...policies);
      }
    }

    const allPolicies = (policyVersions || [])
      .filter(pv => pv.content && pv.content.length > 100)
      .map(pv => ({ policy_id: pv.policy_id, title: pv.title, content: pv.content || "" }));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const questions: any[] = [];
    let sent = 0;

    for (const member of staff) {
      const today = new Date().toISOString().split("T")[0];
      const { data: existing } = await supabase
        .from("daily_drill_questions")
        .select("id")
        .eq("staff_id", member.id)
        .gte("sent_at", today + "T00:00:00Z")
        .lte("sent_at", today + "T23:59:59Z")
        .limit(1);

      if (existing && existing.length > 0) continue;

      const deptKey = member.department.toLowerCase();
      let candidatePolicies = deptPolicies[deptKey] || [];
      if (candidatePolicies.length === 0) {
        for (const [key, policies] of Object.entries(deptPolicies)) {
          if (deptKey.includes(key) || key.includes(deptKey)) {
            candidatePolicies = policies;
            break;
          }
        }
      }
      if (candidatePolicies.length === 0) candidatePolicies = allPolicies;
      if (candidatePolicies.length === 0) continue;

      const policy = candidatePolicies[Math.floor(Math.random() * candidatePolicies.length)];
      const truncated = policy.content.replace(/<[^>]+>/g, " ").substring(0, 3000);

      try {
        const aiRes = await fetch("https://api.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro",
            messages: [
              {
                role: "system",
                content: `You are a compliance training quiz generator. Generate exactly ONE multiple-choice question based on the policy provided. The question should test practical understanding, not just memorization. Return ONLY valid JSON with this structure:\n{"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct_answer":"A) ...","explanation":"Brief explanation of why this is correct."}`
              },
              {
                role: "user",
                content: `Generate a compliance quiz question for a ${member.department} staff member based on this policy:\n\nTitle: ${policy.title}\n\nContent:\n${truncated}`
              }
            ],
            temperature: 0,
          }),
        });

        if (!aiRes.ok) {
          console.error(`AI call failed for ${member.email}: ${aiRes.status}`);
          continue;
        }

        const aiData = await aiRes.json();
        const raw = aiData.choices?.[0]?.message?.content || "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error(`No JSON in AI response for ${member.email}`);
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        questions.push({
          staff_id: member.id,
          policy_id: policy.policy_id,
          policy_title: policy.title,
          question: parsed.question,
          options: parsed.options,
          correct_answer: parsed.correct_answer,
          explanation: parsed.explanation || null,
          sent_via_app: true,
          sent_via_email: false,
        });
        sent++;
      } catch (aiErr) {
        console.error(`Error generating question for ${member.email}:`, aiErr);
      }
    }

    if (questions.length > 0) {
      const { error: insertErr } = await supabase
        .from("daily_drill_questions")
        .insert(questions);
      if (insertErr) throw insertErr;
    }

    return new Response(JSON.stringify({ sent, total_staff: staff.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Daily drill error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
