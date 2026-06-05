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

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Grab a random sample of published policies for quiz material
    const { data: policies } = await sb
      .from("policy_versions")
      .select("title, content, category")
      .eq("status", "published")
      .limit(10);

    const policySummaries = (policies || [])
      .map(p => `- **${p.title}** (${p.category}): ${(p.content || "").slice(0, 300)}`)
      .join("\n");

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `You are a compliance training bot. Generate exactly ONE multiple-choice quiz question based on the organization's published policies. The question should test practical knowledge that a healthcare employee needs.\n\nRules:\n- Return ONLY valid JSON, no markdown wrapping\n- Format: { "question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correct": 0, "explanation": "...", "policyRef": "..." }\n- "correct" is the 0-based index of the correct answer\n- "policyRef" is the title of the source policy\n- Make it scenario-based when possible (e.g., "A nurse discovers...")\n- Difficulty: moderate — not obvious but not trick questions\n- Use today's date seed for variety: ${today}`;

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
          { role: "user", content: `Generate a daily drill question from these policies:\n\n${policySummaries || "No policies available — generate a general HIPAA compliance question."}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "generate_quiz",
            description: "Generate a single compliance quiz question",
            parameters: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: { type: "array", items: { type: "string" } },
                correct: { type: "number" },
                explanation: { type: "string" },
                policyRef: { type: "string" },
              },
              required: ["question", "options", "correct", "explanation", "policyRef"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "generate_quiz" } },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("daily-drill error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let quiz;
    if (toolCall?.function?.arguments) {
      quiz = JSON.parse(toolCall.function.arguments);
    } else {
      // Fallback: try parsing content directly
      const content = data.choices?.[0]?.message?.content || "";
      quiz = JSON.parse(content);
    }

    return new Response(JSON.stringify(quiz), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("daily-drill error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
