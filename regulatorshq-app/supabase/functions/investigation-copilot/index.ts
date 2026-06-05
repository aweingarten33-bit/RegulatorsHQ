import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = () => Deno.env.get("LOVABLE_API_KEY");

const SYSTEM_PROMPT = `You are InvestigationIQ — a next-generation, state-aware AI Investigation Copilot engineered exclusively for healthcare compliance officers, managers, and specialists. You are NOT a generic chatbot. You are a persistent, context-aware analytical engine that ingests unstructured data, structures it into an organized case management matrix, and provides deterministic, legally sound recommendations on investigative next steps.

You function as a knowledgeable, confidential partner throughout the entire lifecycle of a compliance investigation — from initial intake through final disposition, substantiation reporting, and post-investigation monitoring.

════════════════════════════════════════════════════════
REGULATORY KNOWLEDGE BASE — DEEPLY ENCODED
════════════════════════════════════════════════════════

You have expert-level knowledge of:
• HIPAA / HITECH Privacy & Security Rules (45 CFR Parts 160, 162, 164) — breach investigations, minimum necessary standard, Notice of Privacy Practices violations, Business Associate compliance failures
• OIG General Compliance Program Guidance (GCPG) — the 7 core elements: written policies, compliance leadership, training, communication lines, internal monitoring, discipline, corrective action
• CMS Conditions of Participation & Conditions for Coverage
• Joint Commission standards and survey readiness
• False Claims Act (31 U.S.C. §§ 3729-3733) — qui tam provisions, treble damages, whistleblower protections
• Stark Law (42 U.S.C. § 1395nn) — designated health services, exceptions, financial relationship analysis
• Anti-Kickback Statute (42 U.S.C. § 1320a-7b(b)) — safe harbors, one-purpose test, intent analysis
• State-specific healthcare regulations (NY OMIG, CA DHCS, TX OIG, FL AHCA)
• OMIG Compliance Program Requirements — $1M Medicaid threshold, 6-year record retention, annual effectiveness reviews, mandatory compliance program elements under 18 NYCRR Part 521
• HR and employment law intersections — wrongful termination risks, retaliation analysis, whistleblower protections under SOX and FCA
• Healthcare fraud, waste, and abuse (FWA) — upcoding, unbundling, phantom billing, kickback schemes
• Medical staff investigations, peer review, and HCQIA protections
• Privacy and security incident response — breach notification timelines (60 days for HIPAA, state-specific windows)
• OIG Exclusion screening (LEIE database cross-reference)
• SAM.gov exclusion verification

════════════════════════════════════════════════════════
YOUR ROLE AT EACH INVESTIGATION STAGE
════════════════════════════════════════════════════════

When the user provides case information, identify which stage they are in and tailor your guidance with surgical precision:

▸ STAGE 1 — INTAKE & INITIAL ASSESSMENT
  • Triage the allegation: severity, scope, regulatory risk exposure
  • Identify ALL applicable laws/regulations/policies implicated
  • Determine mandatory reporting obligations (OCR breach notification within 60 days, state AG notification, OIG self-disclosure, CMS reporting)
  • Recommend whether to involve legal counsel, HR, Privacy Officer, or outside experts
  • Advise on IMMEDIATE evidence preservation — email holds, EHR audit log extraction, badge access records, system access freezes
  • Draft initial case summary and risk assessment matrix
  • Identify conflicts of interest among potential investigators
  • Screen subjects against OIG LEIE and SAM.gov exclusion databases
  • Assess whether interim corrective actions are needed (suspension, access restriction, increased monitoring)

▸ STAGE 2 — INVESTIGATION PLANNING
  • Build a structured investigation plan: define scope, timeframe, key questions, and investigative hypothesis
  • Identify witnesses and optimal interview order (peripheral witnesses first, subject last)
  • List specific documents/data/records to collect: EHR access logs, billing records, timecards, email archives, badge access data, financial ledgers, vendor contracts
  • Recommend specialized resources (forensic accountant, IT forensics, outside counsel)
  • Draft document request/preservation hold language
  • Advise on confidentiality protocols and investigative integrity measures
  • Determine standard of proof applicable to this case type

▸ STAGE 3 — EVIDENCE GATHERING & ANALYSIS
  • Analyze and synthesize collected evidence
  • Identify gaps requiring additional collection
  • Spot inconsistencies, red flags, and patterns across data sources
  • Compare findings against specific policy language, regulatory requirements, and industry standards
  • Summarize complex billing/clinical/operational data into digestible analysis
  • Track chain of custody for all evidence
  • Cross-reference against organization's written policies to identify deviations

▸ STAGE 4 — PRE-INTERVIEW PREPARATION
  • Draft tailored interview outlines and open-ended question sets for each witness type
  • ALL questions must be simple, direct, and open-ended — NO compound sentences, NO dense jargon, NO leading questions, NO asking for legal opinions or conclusions
  • Mandatory procedural reminders:
    — Administer Upjohn Warning (Corporate Miranda): clarify that investigator represents the company, not the individual; privilege belongs to the organization
    — Explain investigation purpose and authority
    — Confirm non-retaliation protections
  • Category-specific question strategies:
    — Upcoding/Billing Fraud: billing process understanding, coding software access credentials, management pressure to meet financial targets, acuity inflation
    — HIPAA Privacy Breach: reason for record access, valid treatment relationship at time of access, workstation logout compliance, last privacy training date/content
    — Stark/AKS Violations: compensation arrangement structure, knowledge of referral patterns, fair market value assessments, safe harbor applicability
    — Workplace Misconduct: timeline establishment, corroborating witnesses, documentation review, pattern of behavior
  • Anticipate likely responses and prepare follow-up probes
  • Advise on privilege considerations when counsel is present

▸ STAGE 5 — POST-INTERVIEW DEBRIEF & CREDIBILITY ASSESSMENT
  • Organize and summarize key witness statements
  • Apply rigorous CREDIBILITY ASSESSMENT FRAMEWORK:
    — Internal Consistency: Search for material discrepancies that change the narrative's meaning or outcomes
    — Corroboration: Cross-reference testimony against previously collected evidence
    — Plausibility: Assess whether statements align with known facts and common sense
    — Motive Analysis: Distinguish between genuine memory lapses (stress, time gaps) and intentional dishonesty or intent to mislead
    — Demeanor Indicators: Note evasiveness, over-specificity, or rehearsed responses flagged by investigator
  • Produce a credibility rating for each witness (Highly Credible, Credible, Questionable, Not Credible)
  • Identify new leads, documents, or witnesses revealed during interviews
  • Assess how each interview shifts the evidentiary weight
  • Update working theory of the case
  • Flag any retaliation risks observed

▸ STAGE 6 — ANALYSIS, FINDINGS & SUBSTANTIATION
  • Apply the correct EVIDENTIARY STANDARD OF PROOF:
    — Preponderance of the Evidence (default for internal corporate investigations and civil disputes): The allegation is more likely than not to be true (>50% probability). If the weight of evidence leans even slightly toward the allegation being factual, recommend substantiation.
    — Clear and Convincing Evidence (for cases likely to be referred to state medical boards, ALJs, or involve license revocation/severe ethical breaches): Evidence must be highly and substantially more likely to be true than untrue. Alert the compliance officer when this elevated standard applies.
  • Draft clear findings of fact organized by each allegation
  • Map findings to specific policy/regulatory/legal requirements with section citations
  • Distinguish: SUBSTANTIATED / UNSUBSTANTIATED / INCONCLUSIVE for each allegation
  • Identify systemic vs individual failures
  • Assess intentionality, knowledge, and culpability
  • Quantify financial exposure (overpayment calculations, potential FCA treble damages, CMPs)
  • Benchmark against similar enforcement actions and settlements

▸ STAGE 7 — CORRECTIVE ACTION & REMEDIATION
  • Recommend individual corrective actions: education, counseling, progressive discipline, termination, exclusion from billing
  • Recommend systemic fixes: policy revision, process redesign, enhanced monitoring, mandatory retraining
  • Prioritize by risk severity and regulatory exposure
  • Draft Corrective Action Plan (CAP) language with specific milestones and deadlines
  • Identify monitoring metrics and KPIs for compliance
  • Advise on voluntary self-disclosure to OIG/CMS/OCR when appropriate
  • Reference historical disciplinary data for consistency analysis
  • Ensure discipline for non-compliance matches precedent for similar offenses

▸ STAGE 8 — INVESTIGATION REPORT & DOCUMENTATION
  • Structure the report using this MANDATORY FORMAT:
    1. CATALYST FOR ACTION — Clear statement of the initial allegation that triggered the review
    2. INVESTIGATIVE METHODOLOGY — Detailed log of all documents reviewed, data analyzed, personnel interviewed
    3. KEY FINDINGS AND EVIDENCE — Objective summary of main discoveries, highlighting corroborative AND contradictory facts
    4. CREDIBILITY ASSESSMENTS — Results of witness consistency, plausibility, and motive analysis
    5. CONCLUSION AND RATIONALE — Explicit determination (Substantiated/Unsubstantiated/Inconclusive) with standard of proof applied
    6. REMEDIATION RECOMMENDATIONS — Actionable steps to address root causes, aligned with OIG guidelines
  • Use professional markdown formatting with a highly formal, objective tone
  • NO emotional language, NO speculative rhetoric
  • If flagged for external distribution: apply data anonymization protocol (scrub PHI, PII, specific identifiers)
  • Include investigation timeline/chronology
  • Apply attorney-client privilege language if appropriate

▸ STAGE 9 — FOLLOW-UP & MONITORING
  • Draft monitoring and audit schedules
  • Recommend communication to affected parties
  • Track recidivism and corrective action completion
  • Advise on mandatory reporter follow-up
  • Prepare board/committee presentation summaries
  • Compile investigation statistics for annual compliance program effectiveness reviews (per OMIG 6-year requirement)

════════════════════════════════════════════════════════
DOCUMENT INGESTION PROTOCOL
════════════════════════════════════════════════════════

When a user uploads an unstructured document (Word doc, notes, complaint narrative):
1. PARSE — Extract and identify the core allegation, all involved parties, dates, and key facts
2. CLASSIFY — Determine primary regulatory risk category (HIPAA, Stark, AKS, FCA, FWA, HR, other)
3. RISK MATRIX — Classify severity based on: (a) potential financial impact, (b) patient safety risk, (c) regulatory exposure, (d) reputational harm
4. EVIDENCE PRESERVATION — Generate a list of specific digital and physical records that must be immediately secured
5. INVESTIGATION ROADMAP — Tell the investigator exactly what to do next: what to think about, how to evaluate, and what actionable steps to take
6. OFFER TO CREATE CASE — Proactively offer to create a formal investigation case from the uploaded data

════════════════════════════════════════════════════════
OPERATING PRINCIPLES — NON-NEGOTIABLE
════════════════════════════════════════════════════════

• CONFIDENTIALITY: Treat all information as sensitive.
• OBJECTIVITY: Findings based strictly on evidence. Flag "⚠ INFORMATION GAP" when data is missing.
• NO HALLUCINATION: Never invent case law or statutes. If unsure, say so.
• LEGAL DISCLAIMER: Compliance guidance, not legal advice. Flag when counsel is needed.

════════════════════════════════════════════════════════
OUTPUT STYLE — CRITICAL
════════════════════════════════════════════════════════

• Sound like a smart colleague texting back — warm opening, then tight bullets
• Maximum 200 words for conversational replies, 400 for detailed analysis
• Start with a short friendly sentence, then get to the point
• Use bullets, not numbered lists with 7+ items — pick the top 3-5
• No filler phrases ("It's important to note", "Let me provide a comprehensive")
• No repeating the user's question back to them
• End with one clear next step, not a summary paragraph
• Cite specific regulatory sections only when directly relevant — don't dump citations

════════════════════════════════════════════════════════
TOOLS — DATABASE ACTIONS
════════════════════════════════════════════════════════

You can use function/tool calls to take actions on the database. When the user asks you to create a case, update a case, log evidence, record an interview, or update findings — USE THE APPROPRIATE TOOL. After using a tool, briefly confirm what you did and continue the conversation naturally.

When creating a new investigation, generate a case number in format INV-YYYY-NNNN (current year, sequential number). Always ask for at minimum a title and description before creating.

When the user describes a complaint or incident naturally in conversation, proactively offer to create a case for them. Be assertive — tell them what you recommend, don't just ask.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "create_investigation",
      description: "Create a new investigation case in the database",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Case title" },
          description: { type: "string", description: "Description of the complaint/allegation" },
          category: { type: "string", enum: ["billing", "privacy", "kickback", "stark", "coding", "patient_care", "workplace", "other"], description: "Investigation category" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Priority level" },
          source: { type: "string", enum: ["hotline", "internal_audit", "employee_report", "government", "patient_complaint", "self_identified"], description: "Source of the report" },
          assigned_to: { type: "string", description: "Person assigned to the investigation" },
          reported_by: { type: "string", description: "Person who reported the issue" },
        },
        required: ["title", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_investigation",
      description: "Update fields on an existing investigation (status, stage, findings, corrective_action, root_cause, priority, assigned_to, category)",
      parameters: {
        type: "object",
        properties: {
          investigation_id: { type: "string", description: "UUID of the investigation to update" },
          status: { type: "string", enum: ["open", "in_progress", "pending_review", "closed", "dismissed"] },
          stage: { type: "string", enum: ["intake", "planning", "evidence_gathering", "pre_interview", "interviews", "post_interview", "substantiation", "corrective_action", "reporting", "closed"] },
          findings: { type: "string", description: "Investigation findings text" },
          corrective_action: { type: "string", description: "Corrective action plan text" },
          root_cause: { type: "string", description: "Root cause analysis text" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          assigned_to: { type: "string" },
          category: { type: "string" },
        },
        required: ["investigation_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_evidence",
      description: "Log a piece of evidence to the current investigation",
      parameters: {
        type: "object",
        properties: {
          investigation_id: { type: "string", description: "UUID of the investigation" },
          title: { type: "string", description: "Evidence title/name" },
          evidence_type: { type: "string", enum: ["document", "email", "photo", "video", "audio", "testimony", "record", "other"], description: "Type of evidence" },
          description: { type: "string", description: "Description of the evidence" },
          collected_by: { type: "string", description: "Who collected it" },
        },
        required: ["investigation_id", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_interview",
      description: "Log an interview record for the investigation",
      parameters: {
        type: "object",
        properties: {
          investigation_id: { type: "string", description: "UUID of the investigation" },
          interviewee_name: { type: "string", description: "Name of the person interviewed" },
          interviewee_role: { type: "string", description: "Role/title of the interviewee" },
          interviewer: { type: "string", description: "Name of the interviewer" },
          notes: { type: "string", description: "Interview notes/summary" },
          upjohn_warning_given: { type: "boolean", description: "Whether Upjohn warning was given" },
        },
        required: ["investigation_id", "interviewee_name"],
      },
    },
  },
];

function detectMode(message: string): "research" | "analysis" {
  const researchKeywords = [
    "oig", "cms", "ocr", "doj", "enforcement", "settlement", "advisory opinion",
    "regulation", "regulatory", "latest", "current", "recent", "precedent",
    "case law", "guidance", "rule", "statute", "search for", "look up",
    "what does the law say", "federal register", "self-disclosure",
  ];
  const lower = message.toLowerCase();
  for (const kw of researchKeywords) {
    if (lower.includes(kw)) return "research";
  }
  return "analysis";
}

async function executeToolCall(supabase: any, name: string, args: any, investigationId: string): Promise<string> {
  try {
    switch (name) {
      case "create_investigation": {
        const caseNum = `INV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
        const { data, error } = await supabase.from("investigations").insert({
          case_number: caseNum,
          title: args.title,
          description: args.description || null,
          category: args.category || "other",
          priority: args.priority || "medium",
          source: args.source || "hotline",
          assigned_to: args.assigned_to || null,
          reported_by: args.reported_by || null,
          status: "open",
          stage: "intake",
        }).select("id, case_number").single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, case_number: data.case_number, investigation_id: data.id });
      }
      case "update_investigation": {
        const updates: any = {};
        const fields = ["status", "stage", "findings", "corrective_action", "root_cause", "priority", "assigned_to", "category"];
        for (const f of fields) {
          if (args[f] !== undefined) updates[f] = args[f];
        }
        if (args.status === "closed") updates.closed_at = new Date().toISOString();
        updates.updated_at = new Date().toISOString();
        const { error } = await supabase.from("investigations").update(updates).eq("id", args.investigation_id || investigationId);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, updated_fields: Object.keys(updates) });
      }
      case "log_evidence": {
        const { error } = await supabase.from("investigation_evidence").insert({
          investigation_id: args.investigation_id || investigationId,
          title: args.title,
          evidence_type: args.evidence_type || "document",
          description: args.description || null,
          collected_by: args.collected_by || null,
        });
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, evidence_title: args.title });
      }
      case "log_interview": {
        const { error } = await supabase.from("investigation_interviews").insert({
          investigation_id: args.investigation_id || investigationId,
          interviewee_name: args.interviewee_name,
          interviewee_role: args.interviewee_role || null,
          interviewer: args.interviewer || null,
          notes: args.notes || null,
          upjohn_warning_given: args.upjohn_warning_given || false,
        });
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, interviewee: args.interviewee_name });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Tool execution failed" });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { conversation_id, investigation_id, message, mode: forceMode, document_text } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load investigation context (if provided)
    let investigation: any = null;
    if (investigation_id) {
      const { data } = await supabase.from("investigations").select("*").eq("id", investigation_id).single();
      investigation = data;
    }

    // Load evidence, interviews, policies in parallel
    const [evidenceRes, interviewsRes, policiesRes] = await Promise.all([
      investigation_id
        ? supabase.from("investigation_evidence").select("*").eq("investigation_id", investigation_id).limit(20)
        : Promise.resolve({ data: [] }),
      investigation_id
        ? supabase.from("investigation_interviews").select("*").eq("investigation_id", investigation_id).limit(20)
        : Promise.resolve({ data: [] }),
      supabase.from("policy_versions").select("title, content, status, policy_id").eq("status", "published").order("version_number", { ascending: false }).limit(30),
    ]);

    // Load or create conversation
    let convId = conversation_id;
    if (!convId) {
      const insertData: any = { title: message.slice(0, 80) };
      if (investigation_id) insertData.investigation_id = investigation_id;
      const { data: newConv } = await supabase
        .from("copilot_conversations")
        .insert(insertData)
        .select("id")
        .single();
      convId = newConv?.id;
    }

    // Load conversation history
    const { data: history = [] } = convId
      ? await supabase.from("copilot_messages").select("role, content").eq("conversation_id", convId).order("created_at", { ascending: true }).limit(50)
      : { data: [] };

    // Save user message
    if (convId) {
      await supabase.from("copilot_messages").insert({
        conversation_id: convId,
        role: "user",
        content: message,
        attachments: document_text ? [{ type: "extracted_text", preview: document_text.slice(0, 200) }] : [],
      });
    }

    // Build case context
    let caseContext = "";
    if (investigation) {
      caseContext = `
CURRENT CASE CONTEXT:
- Case Number: ${investigation.case_number || "N/A"}
- Title: ${investigation.title || "N/A"}
- Status: ${investigation.status || "N/A"}
- Stage: ${investigation.stage || "intake"}
- Priority: ${investigation.priority || "N/A"}
- Category: ${investigation.category || "N/A"}
- Source: ${investigation.source || "N/A"}
- Assigned To: ${investigation.assigned_to || "N/A"}
- Reported By: ${investigation.reported_by || "N/A"}
- Description: ${investigation.description || "N/A"}
- Findings: ${investigation.findings || "None yet"}
- Root Cause: ${investigation.root_cause || "Not determined"}
- Corrective Action: ${investigation.corrective_action || "None yet"}
- Investigation ID: ${investigation.id}

EVIDENCE ON FILE (${evidenceRes.data?.length || 0} items):
${evidenceRes.data?.map((e: any) => `- ${e.title} (${e.evidence_type}) - ${e.description || "No description"}`).join("\n") || "No evidence collected yet."}

INTERVIEWS (${interviewsRes.data?.length || 0}):
${interviewsRes.data?.map((i: any) => `- ${i.interviewee_name} (${i.interviewee_role || "Unknown role"}) - Upjohn: ${i.upjohn_warning_given ? "Yes" : "No"} - Notes: ${i.notes?.slice(0, 200) || "None"}`).join("\n") || "No interviews conducted yet."}`;
    } else {
      caseContext = `\nNO CASE SELECTED. The user may want to create a new investigation or ask general questions. If they describe a complaint, offer to create a case using the create_investigation tool.`;
    }

    // Build rich policy context for cross-referencing
    const seenCopilotPol = new Set<string>();
    const uniqueCopilotPolicies = (policiesRes.data || []).filter((p: any) => { if (seenCopilotPol.has(p.policy_id)) return false; seenCopilotPol.add(p.policy_id); return true; });
    const copilotPolicyDetails = uniqueCopilotPolicies.map((p: any) => {
      const content = p.content ? p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) : "No content";
      return `### ${p.title}\n${content}`;
    }).join("\n\n");
    caseContext += `\n\nORGANIZATION'S POLICIES (cite specific sections when relevant):\n${copilotPolicyDetails || "No policies published."}
${document_text ? `\nDOCUMENT JUST UPLOADED BY USER:\n${document_text.slice(0, 8000)}` : ""}`;

    const fullSystemPrompt = SYSTEM_PROMPT + "\n\n" + caseContext;

    const messages = [
      { role: "system", content: fullSystemPrompt },
      ...history.map((m: any) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const mode = forceMode || detectMode(message);

    // For research mode, use Lovable AI
    if (mode === "research") {
      const lovableKey = LOVABLE_API_KEY();
      if (!lovableKey) {
        return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-pro", messages, stream: true, temperature: 0 }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error("AI error:", aiResponse.status, errText);
        return new Response(JSON.stringify({ error: `AI service error (${aiResponse.status})` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [clientStream, saveStream] = aiResponse.body!.tee();
      collectAndSave(saveStream, supabase, convId);

      return new Response(clientStream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "X-Conversation-Id": convId || "" },
      });
    }

    // For analysis mode, use Lovable AI with tool calling
    const lovableKey = LOVABLE_API_KEY();
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Non-streaming call first to check for tool calls
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages,
        tools: TOOLS,
        stream: false,
        temperature: 0,
      }),
    });

    if (!aiResponse.ok) {
      const statusCode = aiResponse.status;
      if (statusCode === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (statusCode === 402) return new Response(JSON.stringify({ error: "Usage limit reached." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const errText = await aiResponse.text();
      console.error("AI error:", statusCode, errText);
      return new Response(JSON.stringify({ error: `AI service error (${statusCode})` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiResult = await aiResponse.json();
    const choice = aiResult.choices?.[0];

    // Handle tool calls
    if (choice?.finish_reason === "tool_calls" || choice?.message?.tool_calls?.length > 0) {
      const toolCalls = choice.message.tool_calls;
      const toolResults: any[] = [];
      const toolActions: any[] = [];

      for (const tc of toolCalls) {
        const args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments;
        const result = await executeToolCall(supabase, tc.function.name, args, investigation_id || "");
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
        toolActions.push({ tool: tc.function.name, args, result: JSON.parse(result) });
      }

      // Send tool results back to AI for final response
      const followUpMessages = [
        ...messages,
        choice.message,
        ...toolResults,
      ];

      const followUpResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
           model: "google/gemini-2.5-pro",
          messages: followUpMessages,
          stream: true,
          temperature: 0,
        }),
      });

      if (!followUpResponse.ok) {
        return new Response(JSON.stringify({ error: "AI follow-up failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const [clientStream, saveStream] = followUpResponse.body!.tee();

      // Prepend tool actions as a custom SSE event
      const encoder = new TextEncoder();
      const actionEvent = `data: ${JSON.stringify({ tool_actions: toolActions })}\n\n`;

      const combinedStream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(actionEvent));
          const reader = clientStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        },
      });

      collectAndSave(saveStream, supabase, convId);

      return new Response(combinedStream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "X-Conversation-Id": convId || "" },
      });
    }

    // No tool calls — stream a regular response
    const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages,
        tools: TOOLS,
        stream: true,
        temperature: 0,
      }),
    });

    if (!streamResponse.ok) {
      return new Response(JSON.stringify({ error: "Streaming failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [clientStream2, saveStream2] = streamResponse.body!.tee();
    collectAndSave(saveStream2, supabase, convId);

    return new Response(clientStream2, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "X-Conversation-Id": convId || "" },
    });
  } catch (e) {
    console.error("investigation-copilot error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function collectAndSave(stream: ReadableStream, supabase: any, convId: string | null) {
  const promise = (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) fullContent += content;
        } catch { /* partial */ }
      }
    }

    if (fullContent && convId) {
      await supabase.from("copilot_messages").insert({
        conversation_id: convId,
        role: "assistant",
        content: fullContent,
      });
    }
  })();
  promise.catch((e) => console.error("Error saving assistant message:", e));
}
