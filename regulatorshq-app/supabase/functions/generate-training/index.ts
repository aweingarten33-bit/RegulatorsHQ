import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { policyTitle, policyContent, policyCategory } = await req.json();

    if (!policyTitle || !policyContent) {
      return new Response(JSON.stringify({ error: "Missing policyTitle or policyContent" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const plainContent = policyContent.replace(/<[^>]*>/g, "").slice(0, 8000);

    const systemPrompt = `You are an expert healthcare compliance training designer AND content marketing strategist. You create comprehensive training materials AND social media content from policy documents.\n\nYour output must be valid JSON with this exact structure:\n{\n  "executive_summary": "A concise 150-200 word executive summary of the policy for leadership.",\n  "briefing_doc": "A comprehensive 400-600 word briefing document in markdown format with sections: ## Overview, ## Key Requirements, ## Compliance Implications, ## Action Items, ## Risk Considerations.",\n  "faq": [\n    { "question": "FAQ question?", "answer": "Clear, practical answer." }\n  ],\n  "dialogue": [\n    { "speaker": "A", "text": "Hey, so today we're diving into something really important..." },\n    { "speaker": "B", "text": "Yeah, this is a big one. So basically what this policy is about..." }\n  ],\n  "script": "A plain 2-minute narration script (300 words) for single-voice fallback.",\n  "slides": [\n    {\n      "title": "Slide title",\n      "bullets": ["Point 1", "Point 2", "Point 3"],\n      "speaker_notes": "Presenter notes"\n    }\n  ],\n  "key_takeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3", "Takeaway 4", "Takeaway 5"],\n  "quiz": [\n    {\n      "question": "Question?",\n      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],\n      "correct": 0,\n      "explanation": "Why this is correct"\n    }\n  ],\n  "social_posts": {\n    "linkedin": "A professional LinkedIn post (150-250 words).",\n    "twitter_thread": ["Tweet 1", "Tweet 2", "Tweet 3", "Tweet 4", "Tweet 5"],\n    "instagram_caption": "An Instagram caption (100-150 words)."\n  },\n  "what_if_scenario": {\n    "headline": "A provocative What If? question",\n    "dystopia": "100-150 word worst-case narrative",\n    "utopia": "100-150 word best-case narrative",\n    "takeaway": "Single punchy sentence"\n  },\n  "infographic_brief": {\n    "title": "Bold headline",\n    "subtitle": "One-line context setter",\n    "stats": [{ "label": "Stat label", "value": "Bold number" }],\n    "timeline": [{ "step": "Step name", "description": "Brief description" }],\n    "comparison": { "without": "2-3 sentences", "with": "2-3 sentences" },\n    "bottom_line": "Single sentence takeaway"\n  }\n}\n\nThe dialogue MUST be a NotebookLM-style conversational podcast between two hosts (20-30 turns, Speaker A is Troy McClure-style enthusiastic, Speaker B is grounded and curious). Other requirements: 8-10 FAQ pairs, 6-8 slides, 5 quiz questions, 5 key takeaways.`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Create a complete training & content package for this document:\n\nTitle: ${policyTitle}\nCategory: ${policyCategory || "General"}\n\nContent:\n${plainContent}` },
        ],
        temperature: 0,
        max_tokens: 14000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("AI gateway error:", err);
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI generation failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return new Response(JSON.stringify({ error: "No content generated" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let training;
    try {
      let cleaned = content.trim().replace(/^﻿/, "");
      const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
      if (fenceMatch) cleaned = fenceMatch[1].trim();
      const firstBrace = cleaned.indexOf("{");
      if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);
      const lastBrace = cleaned.lastIndexOf("}");
      if (lastBrace !== -1 && lastBrace < cleaned.length - 1) cleaned = cleaned.slice(0, lastBrace + 1);
      training = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Raw AI content (first 500 chars):", content?.slice(0, 500));
      throw new Error("Failed to parse AI response as JSON");
    }

    return new Response(JSON.stringify({ success: true, training }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("generate-training error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
