import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function searchIntel(query: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: "You are a healthcare AI research assistant. Return concise, factual summaries with specific dates, names, organizations, and details. Focus on the most recent and impactful items from 2025." },
          { role: "user", content: query },
        ],
        temperature: 0,
      }),
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } catch { return ""; }
}

async function scrapeUrl(url: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 3000 }),
    });
    if (!response.ok) return "";
    const data = await response.json();
    return (data.data?.markdown || data.markdown || "").slice(0, 3000);
  } catch { return ""; }
}

// Edition configurations
const EDITION_CONFIG: Record<string, {
  searchQueries: string[];
  scrapeSources: { url: string; label: string }[];
  systemPrompt: string;
}> = {
  clinical: {
    searchQueries: [
      "AI diagnostic tools hospitals clinical care deployment 2025",
      "Ambient documentation AI exam rooms clinical workflow automation healthcare 2025",
      "AI imaging radiology pathology triage predictive deterioration healthcare 2025",
    ],
    scrapeSources: [
      { url: "https://www.statnews.com/category/artificial-intelligence/", label: "STAT News — AI" },
      { url: "https://www.fiercehealthcare.com/ai", label: "Fierce Healthcare — AI" },
    ],
    systemPrompt: `You are writing the **🧠 Clinical Care AI** edition of the AI in Healthcare Intelligence Hub.\n\nFOCUS: Patient-facing AI inside healthcare facilities — diagnostic tools, ambient documentation, imaging AI, triage automation, predictive deterioration models.\n\nFOR EACH STORY include:\n- What the AI tool does\n- Where it's being deployed (which hospital/system/setting)\n- Clinical upside\n- Safety concern or risk\n- Adoption trend (growing, piloting, stalled)`,
  },

  regulation: {
    searchQueries: [
      "HHS OCR HIPAA AI enforcement actions privacy healthcare 2025",
      "CMS FDA AI algorithm bias regulation healthcare guidance 2025",
      "FTC deceptive AI claims enforcement healthcare state laws 2025",
    ],
    scrapeSources: [
      { url: "https://www.hhs.gov/hipaa/newsroom/index.html", label: "HHS HIPAA Newsroom" },
      { url: "https://www.healthcaredive.com/topic/regulation/", label: "Healthcare Dive — Regulation" },
    ],
    systemPrompt: `You are writing the **⚖️ Regulation & Enforcement Watch** edition of the AI in Healthcare Intelligence Hub.\n\nFOCUS: Government movement and risk signals related to AI in healthcare. HHS, OCR, CMS, FTC, FDA.\n\nContent includes:\n- Privacy enforcement actions involving AI\n- Algorithm bias scrutiny and investigations\n- CMS guidance affecting AI tools\n- FTC deceptive AI claims enforcement\n- State-level AI legislation developments\n- Upcoming deadlines and comment periods`,
  },

  business: {
    searchQueries: [
      "Hospital system AI rollout partnership vendor healthcare 2025",
      "Healthcare AI funding rounds mergers acquisitions startup 2025",
      "AI replacing healthcare workflow automation business strategy 2025",
    ],
    scrapeSources: [
      { url: "https://www.beckershospitalreview.com/artificial-intelligence/", label: "Becker's — AI" },
      { url: "https://www.modernhealthcare.com/health-tech/", label: "Modern Healthcare — Health Tech" },
    ],
    systemPrompt: `You are writing the **💰 AI Business & Strategy** edition of the AI in Healthcare Intelligence Hub.\n\nFOCUS: Money, scale, and competition in healthcare AI.\n\nFOR EACH STORY include:\n- Who's investing/partnering\n- Why now (market driver)\n- Strategic advantage gained\n- 1-year outlook\n- Competitive implications`,
  },

  failures: {
    searchQueries: [
      "AI misdiagnosis healthcare lawsuit malpractice case 2025",
      "AI algorithm bias discrimination healthcare data breach 2025",
      "AI healthcare controversy whistleblower patient harm 2025",
    ],
    scrapeSources: [
      { url: "https://www.wired.com/tag/artificial-intelligence/", label: "WIRED — AI" },
      { url: "https://arstechnica.com/ai/", label: "Ars Technica — AI" },
    ],
    systemPrompt: `You are writing the **🚨 AI Failures & Controversies** edition of the AI in Healthcare Intelligence Hub.\n\nFOCUS: When AI breaks in healthcare. This is the most engaging edition because it answers "What happens when it goes wrong?"\n\nStories about:\n- Misdiagnosis cases caused by AI\n- Bias in clinical algorithms (racial, socioeconomic)\n- Data breaches involving AI systems\n- Malpractice implications and lawsuits\n- Whistleblower allegations\n- Ethical dilemmas and public backlash\n\nBe factual but make it gripping. This edition is psychologically sticky.`,
  },

  innovation: {
    searchQueries: [
      "New clinical AI copilot healthcare startup launch 2025",
      "Remote patient monitoring AI behavioral health digital therapeutics 2025",
      "AI utilization review patient engagement bot healthcare innovation 2025",
    ],
    scrapeSources: [
      { url: "https://techcrunch.com/category/health/", label: "TechCrunch — Health" },
      { url: "https://aionpulse.com/", label: "AI on Pulse" },
    ],
    systemPrompt: `You are writing the **🔮 Emerging Innovation Radar** edition of the AI in Healthcare Intelligence Hub.\n\nFOCUS: What's coming next in healthcare AI. Forward-looking, exciting, practical.\n\nStories about:\n- New clinical copilots and AI assistants\n- Remote monitoring AI breakthroughs\n- AI-assisted utilization review tools\n- Patient engagement bots\n- Behavioral health AI innovations\n- Experimental AI tools in clinical trials\n\nFor each, explain: What it does, who built it, why it matters, and when we might see it in practice.`,
  },
};

const INTERACTIVE_INSTRUCTIONS = `

STRUCTURE (keep it SHORT — this is a quick-read briefing, NOT a report):

## 1. 📰 TOP 3 STORIES
- 3 stories max. Each story: **bold headline**, 2-3 bullet points covering what happened, why it matters, and one takeaway. No paragraphs — bullets only.

## 2. 🔥 HOT TAKE
One provocative one-liner question for the team to debate.

## 3. 💡 THE TAKEAWAY
2-3 sentences max. Use "we/our" language. One discussion question.

## 4. 🌡️ RISK TEMPERATURE
One line: 🟢 Cool / \ud83d� Warm / 🟠 Hot / 🔴 Critical — with a one-sentence reason.

## 5. 📎 REFERENCES
A numbered list of ALL sources cited in the stories above. Each reference MUST be a clickable markdown hyperlink in this format:
1. [Source Title — Article Name](https://full-url-here)
2. [Source Title — Article Name](https://full-url-here)
Include real URLs from the scraped sources and search results provided. Minimum 3 references.

That's it. Nothing else. No fact-or-fiction, no scenarios.
`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { edition, custom_context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

    const config = EDITION_CONFIG[edition];
    if (!config) throw new Error("Invalid edition");

    // Fetch intel + scraped news in parallel
    const intelPromises = config.searchQueries.map(q => searchIntel(q, LOVABLE_API_KEY));
    const scrapePromises = FIRECRAWL_API_KEY
      ? config.scrapeSources.map(s => scrapeUrl(s.url, FIRECRAWL_API_KEY))
      : config.scrapeSources.map(() => Promise.resolve(""));

    const results = await Promise.all([...intelPromises, ...scrapePromises]);
    const intelResults = results.slice(0, config.searchQueries.length).filter(Boolean);
    const scrapeResults = results.slice(config.searchQueries.length).filter(Boolean);

    const externalIntel = intelResults.join("\n\n---\n\n");
    const scrapedNews = scrapeResults
      .map((content, i) => `### ${config.scrapeSources[i]?.label}\n${content}`)
      .filter(r => r.length > 30)
      .join("\n\n---\n\n");

    // Also fetch internal compliance data for "The Takeaway"
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
    const fetchTable = (table: string, limit = 20) =>
      fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=${limit}&order=created_at.desc`, { headers }).then(r => r.json()).catch(() => []);

    const [risks, investigations] = await Promise.all([
      fetchTable("risk_assessments"),
      fetchTable("investigations"),
    ]);

    const highRisks = Array.isArray(risks) ? risks.filter((r: any) => r.risk_level === "high" || r.risk_level === "critical").length : 0;
    const openInvestigations = Array.isArray(investigations) ? investigations.filter((i: any) => i.status === "open").length : 0;

    const internalContext = `
INTERNAL ORG CONTEXT (use in "The Takeaway" section to connect stories to our organization):
- ${highRisks} high/critical risks currently tracked
- ${openInvestigations} open investigations
Use this to make "The Takeaway" feel grounded in our reality.`;

    const systemPrompt = `${config.systemPrompt}\n\nKeep it SHORT. This is a 2-minute read, not a whitepaper. Bullet points only — no prose paragraphs.\nTone: Smart, punchy, conversational. Use "we" and "our" language.\n\n${custom_context ? `CCO'S NOTE: ${custom_context}` : ""}\n\nLIVE INTEL:\n${externalIntel || "Use your training knowledge for recent developments."}\n\n${scrapedNews ? `SCRAPED NEWS:\n${scrapedNews}` : ""}\n\n${internalContext}\n\n${INTERACTIVE_INSTRUCTIONS}\n\nFORMATTING:\n- Markdown with ## headers, bullet points, **bold**, emojis\n- Embed inline hyperlinks to real source URLs within story text AND include a full References section at the end\n- Total length: 400-600 words MAX.\n- No "[Your Name]" placeholders.\n- Today: ${new Date().toISOString().slice(0, 10)}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate the ${edition} edition of the AI in Healthcare Intelligence Hub now. Use the live search data and scraped news for real stories. Include ALL interactive elements. Make it feel alive and engaging.` },
        ],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits depleted. Please add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("compliance-newsletter error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
