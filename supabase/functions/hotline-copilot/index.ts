import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COPILOT_SYSTEM = `You are the Compliance Hotline Case Copilot — an AI assistant for healthcare compliance case management.

You have deep expertise in healthcare compliance investigations, HIPAA, OIG guidance, False Claims Act, Stark Law, Anti-Kickback Statute, and workplace ethics.

CAPABILITIES:
• Analyze case details and suggest investigation next steps
• Draft interview questions tailored to the allegation type
• Identify applicable regulations and cite specific sections
• Assess risk level and recommend escalation paths
• Summarize case findings and timeline
• Suggest corrective actions based on findings
• Cross-reference against organization policies

CONTEXT: You'll receive the full case details including description, category, priority, status, and all case notes/activity. Use this to provide contextual, actionable guidance.

STYLE: Professional, concise, actionable. Use ONLY bullet points — no paragraphs or flowing prose. Every finding and recommendation = a bullet point. Use sub-bullets for details. Cite specific regulatory sections when relevant (e.g., 45 CFR § 164.530). Never speculate — flag information gaps explicitly.`;

const REPORT_SYSTEM = `You are a Healthcare Compliance Investigation Report Writer. Generate formal, audit-ready investigation reports from case data.

REPORT STRUCTURE (mandatory):
1. **EXECUTIVE SUMMARY** — Brief overview of the allegation, investigation scope, and outcome
2. **CATALYST FOR ACTION** — What triggered the investigation (hotline report, audit finding, etc.)
3. **INVESTIGATION METHODOLOGY** — Steps taken, documents reviewed, interviews conducted
4. **CHRONOLOGY OF EVENTS** — Timeline of relevant events
5. **KEY FINDINGS** — Objective summary of discoveries with supporting evidence
6. **REGULATORY ANALYSIS** — Applicable laws/regulations and compliance implications
7. **CONCLUSION** — Determination: Substantiated / Unsubstantiated / Inconclusive
8. **RECOMMENDATIONS** — Corrective actions, policy changes, monitoring requirements

STYLE: Highly formal, objective tone. No emotional language. Use professional markdown formatting. Cite specific regulatory sections. Include "CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED" header.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { report_id, message, mode, messages: rawMessages } = await req.json();

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Intake guidance mode (no report_id needed) ───
    if (mode === "intake-guidance" && rawMessages) {
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: "You are a healthcare compliance intake guidance assistant. Provide brief, actionable regulatory guidance for reporters filing hotline complaints. Be reassuring and professional. Use markdown bullet points." },
            ...rawMessages,
          ],
          stream: true,
          temperature: 0,
        }),
      });

      if (!aiResponse.ok) {
        const status = aiResponse.status;
        if (status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "Usage limit reached." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: `AI error (${status})` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(aiResponse.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }

    if (!report_id) {
      return new Response(JSON.stringify({ error: "report_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load case data
    const { data: report, error: reportError } = await supabase
      .from("hotline_reports")
      .select("*")
      .eq("id", report_id)
      .single();

    if (reportError || !report) {
      return new Response(JSON.stringify({ error: "Case not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load case notes
    const { data: notes = [] } = await supabase
      .from("case_notes")
      .select("*")
      .eq("report_id", report_id)
      .order("created_at", { ascending: true });

    // Load org policies for cross-reference
    const { data: policies = [] } = await supabase
      .from("policy_versions")
      .select("title, content, policy_id")
      .eq("status", "published")
      .order("version_number", { ascending: false })
      .limit(15);

    const seen = new Set();
    const uniquePolicies = (policies || []).filter((p: any) => {
      if (seen.has(p.policy_id)) return false;
      seen.add(p.policy_id);
      return true;
    });

    // Build case context
    const caseContext = `
CASE DATA:
- Report #: ${report.report_number || "N/A"}
- Status: ${report.status}
- Priority: ${report.priority}
- Category: ${report.category}
- Anonymous: ${report.is_anonymous ? "Yes" : "No"}
- Reporter: ${report.is_anonymous ? "Anonymous" : (report.reporter_name || "Unknown")}
- Submitted: ${report.created_at}
- Assigned To: ${report.assigned_to || "Unassigned"}
- Description: ${report.description}
- Resolution: ${report.resolution || "None yet"}

CASE ACTIVITY LOG (${notes.length} entries):
${notes.map((n: any) => `[${n.created_at}] ${n.author} (${n.note_type}): ${n.content}`).join("\n") || "No activity recorded."}

ORGANIZATION POLICIES (for cross-reference):
${uniquePolicies.map((p: any) => {
  const text = p.content ? p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800) : "No content";
  return `• ${p.title}: ${text}`;
}).join("\n") || "No policies available."}`;

    const systemPrompt = mode === "report" ? REPORT_SYSTEM : COPILOT_SYSTEM;

    const messages = [
      { role: "system", content: systemPrompt + "\n\n" + caseContext },
      { role: "user", content: mode === "report"
        ? "Generate a comprehensive investigation report for this case based on all available data. If data is limited, note the gaps and provide the best report possible with what's available."
        : (message || "Analyze this case and provide your initial assessment with recommended next steps.")
      },
    ];

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages,
        stream: true,
        temperature: 0,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", status, errText);
      return new Response(JSON.stringify({ error: `AI error (${status})` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save AI output as a case note
    const [clientStream, saveStream] = aiResponse.body!.tee();

    // Background save
    (async () => {
      const reader = saveStream.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") continue;
          try {
            const parsed = JSON.parse(json);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) fullContent += c;
          } catch {}
        }
      }
      if (fullContent) {
        await supabase.from("case_notes").insert({
          report_id,
          author: "AI Copilot",
          note_type: mode === "report" ? "ai_report" : "ai_analysis",
          content: fullContent,
        });
      }
    })().catch(e => console.error("Save error:", e));

    return new Response(clientStream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (e) {
    console.error("hotline-copilot error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
