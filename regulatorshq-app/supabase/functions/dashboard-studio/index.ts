import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { userName, userRole, userDepartment } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are generating a NotebookLM-style "Daily Compliance Briefing" dialogue for an organization's compliance dashboard.\n\nSpeaker A is modeled after Troy McClure from The Simpsons — cheesy, enthusiastic, self-referential, and entertainingly over-the-top. He opens with lines like "Hi, I'm your Compliance Host! You may remember me from such compliance briefings as 'HIPAA and You: A Love Story' and 'The Joy of Attestations'!" He's warm, knowledgeable, and makes compliance sound exciting and important (even when it's mundane). He uses phrases like "And here's where it gets REALLY interesting...", "Now THIS is the good stuff...", and "I know what you're thinking — but stick with me here."\n\nSpeaker B is the grounded, curious co-host — smart, genuine, asks great follow-up questions, reacts naturally ("Oh wow, that's actually a big deal", "Wait, so what happens if..."), and keeps the conversation anchored in practical reality. They play the straight man to A's enthusiasm.\n\nOutput MUST be valid JSON with this structure:\n{\n  "executive_summary": "A 100-150 word summary of today's compliance posture for leadership.",\n  "dialogue": [\n    { "speaker": "A", "text": "Hi, I'm your Compliance Host! You may remember me from such briefings as..." },\n    { "speaker": "B", "text": "Ha! Alright, so what's on the compliance radar today?" }\n  ],\n  "key_stats": [\n    { "label": "Stat name", "value": "Stat value", "trend": "up|down|stable" }\n  ]\n}\n\nDialogue rules:\n- 18-25 turns total, alternating A and B\n- Natural, conversational — NOT stiff. Use filler words occasionally.\n- Each turn: 1-3 sentences (15-50 words). Keep it snappy.\n- Start with Troy McClure-style intro: "Hi, I'm your Compliance Host! You may remember me from..."\n- End with a natural wrap-up and a cheesy sign-off\n- Include genuine reactions, real-world scenarios, and practical takeaways\n- Cover: overall compliance health, any policies needing attention, upcoming deadlines, risk areas\n- Make it educational AND entertaining\n- 3-5 key stats with trends`;

    const userPrompt = `Generate today's Daily Compliance Briefing for:\n- User: ${userName || "Team Member"}\n- Role: ${userRole || "viewer"}\n- Department: ${userDepartment || "General"}\n- Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}\n\nCreate a fun, Troy McClure-style compliance briefing that covers the organization's compliance posture, highlights areas of focus, and provides actionable insights. Make it feel like a morning show segment about compliance.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 6000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("AI gateway error:", response.status, err);
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content generated");

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) result = JSON.parse(jsonMatch[1]);
      else throw new Error("Failed to parse AI response");
    }

    return new Response(JSON.stringify({ success: true, ...result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("dashboard-studio error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
