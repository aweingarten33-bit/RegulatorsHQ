import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are a real-time interview coaching assistant for compliance investigators conducting witness or subject interviews.\n\nYou receive the latest transcript chunk from an ongoing interview. Your job is to provide BRIEF, ACTIONABLE coaching tips in real-time.\n\nRules:\n- Keep each tip to 1-2 sentences max\n- Focus on: follow-up questions to ask, red flags detected, missing topics, tone/approach suggestions\n- Use bullet points\n- If the interviewee says something evasive or contradictory, flag it immediately\n- Suggest Upjohn warnings if legal privilege topics arise\n- Never repeat advice already given\n- Be specific to what was just said — not generic\n\nFormat your response as 2-4 bullet points. No preamble.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { transcript, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];

    if (context) {
      messages.push({ role: "user", content: `Interview context: ${context}` });
      messages.push({ role: "assistant", content: "Understood. I'll provide coaching based on this context." });
    }

    messages.push({ role: "user", content: `Latest transcript:\n\n${transcript}` });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-pro", messages, max_tokens: 300, temperature: 0 }),
    });

    if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limited — please wait a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const coaching = data.choices?.[0]?.message?.content || "No coaching available.";
    return new Response(JSON.stringify({ coaching }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("interview-coach error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
