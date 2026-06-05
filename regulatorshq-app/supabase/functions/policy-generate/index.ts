import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchOrgPolicySummary(): Promise<string> {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: versions } = await sb.from("policy_versions").select("policy_id, title, status, version_number, content").eq("status", "published").order("version_number", { ascending: false });
  const seen = new Set<string>();
  const policies: any[] = [];
  for (const v of versions ?? []) { if (!seen.has(v.policy_id)) { seen.add(v.policy_id); policies.push(v); } }
  const { data: manuals } = await sb.from("manuals").select("title, status");
  const { data: standards } = await sb.from("standards_library").select("accrediting_body, chapter_name").limit(50);
  let context = "## EXISTING POLICIES IN THIS ORGANIZATION\n";
  if (!policies.length) { context += "(No policies yet)\n"; }
  else { for (const p of policies) { const content = p.content ? p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) : "No content"; context += `\n### "${p.title}" (v${p.version_number}, ${p.status})\n${content}\n`; } }
  if (manuals?.length) context += "\n\n## MANUALS\n" + manuals.map(m => `- "${m.title}" (${m.status})`).join("\n");
  if (standards?.length) { const bodies = [...new Set(standards.map(s => s.accrediting_body))]; context += "\n\n## ACCREDITING BODIES TRACKED\n" + bodies.join(", "); }
  return context;
}

function getDocTypeInstructions(docType: string): string {
  const instructions: Record<string, string> = {
    policy: `Generate a formal, operational policy document following the MANDATORY TEMPLATE below.`,
    procedure: `Generate a detailed procedure document. Focus on step-by-step operational workflows with numbered sequences, decision points, and responsible parties for each step. Include flowchart-style logic (if/then) where appropriate.`,
    sop: `Generate a Standard Operating Procedure (SOP). Include purpose, scope, materials/tools needed, detailed sequential steps with sub-steps, quality checks at each stage, expected outcomes, and troubleshooting guidance.`,
    plan: `Generate a formal plan or charter document. Include executive summary, objectives, scope, timeline/milestones, resource requirements, governance structure, risk assessment, success metrics, and review schedule.`,
    form: `Generate a fillable form or worksheet. Use clear field labels with [___________] blanks, checkboxes ☐, tables for data entry, instructions for completion, and submission/routing information.`,
    checklist: `Generate an audit or compliance checklist. Use ☐ checkboxes for each item, organize by category/section, include columns for Status/Evidence/Notes, add regulatory references for each item, and include a completion summary section.`,
    report_template: `Generate a report template with clearly marked sections, placeholder data fields [INSERT], tables for metrics, executive summary area, findings sections, and recommendations format.`,
    memo: `Generate a formal internal memo. Include TO/FROM/DATE/RE header, clear purpose statement, background, key points (bulleted), action items with owners and deadlines, and distribution list.`,
    capa: `Generate a Corrective and Preventive Action (CAPA) document. Include sections for: Event Description, Root Cause Analysis (5-Why or Fishbone), Immediate Corrective Actions, Preventive Actions, Responsible Parties, Timeline, Verification Method, Effectiveness Check, and Closure Criteria.`,
    baa: `Generate a Business Associate Agreement (BAA). Include HIPAA-required provisions: permitted uses/disclosures, safeguards, breach notification obligations, subcontractor requirements, termination provisions, return/destroy PHI obligations, and indemnification. Use formal legal language.`,
    incident_report: `Generate an incident report template. Include: Incident Date/Time/Location, Reporter Information, Description of Event, Immediate Actions Taken, Witnesses, Injuries/Damages, Root Cause, Contributing Factors, Corrective Actions, Follow-up Required, and Regulatory Reporting Obligations.`,
    risk_assessment: `Generate a risk assessment document. Include: Risk Identification, Likelihood Rating (1-5), Impact Rating (1-5), Risk Score Matrix, Current Controls, Residual Risk, Mitigation Strategies, Risk Owner, Review Schedule, and Heat Map summary.`,
    investigation_report: `Generate an investigation report. Include: Case Summary, Allegation/Complaint, Investigation Scope and Methodology, Timeline of Events, Evidence Reviewed, Interview Summaries, Findings of Fact, Analysis, Conclusions, Recommendations, and Corrective Actions.`,
    training_material: `Generate training material content. Include: Learning Objectives, Pre-Assessment Questions, Key Concepts with Examples, Case Studies/Scenarios, Knowledge Check Questions (with answers), Summary/Key Takeaways, and Post-Assessment Quiz.`,
    board_resolution: `Generate a formal board resolution. Include: WHEREAS clauses establishing background and authority, RESOLVED clauses with specific actions, voting requirements, effective date, and signature blocks for officers.`,
    compliance_alert: `Generate a compliance alert/advisory. Include: Alert Level (Critical/High/Medium), Effective Date, Regulatory Source, Summary of Change, Impact Assessment, Required Actions with Deadlines, Resources/References, and Contact for Questions.`,
    vendor_assessment: `Generate a vendor risk assessment document. Include: Vendor Information, Services Provided, Data Access Level, Risk Categories (Security, Privacy, Operational, Financial, Compliance), Assessment Criteria, Scoring Matrix, BAA Status, Exclusion Screening Results, and Recommendations.`,
    gap_analysis: `Generate a gap analysis document. Include: Standard/Framework Being Assessed, Current State Assessment, Required State, Gap Identification, Risk Rating per Gap, Remediation Plan, Priority Ranking, Resource Requirements, and Timeline.`,
    attestation_form: `Generate an attestation/acknowledgment form. Include: Policy/Document Title, Version, Summary of Key Requirements, Acknowledgment Statement, Employee Attestation Fields (Name, Title, Department, Date, Signature), and Annual Renewal Notice.`,
    job_description: `Generate a compliance-focused job description. Include: Position Title, Department, Reports To, FLSA Status, Position Summary, Essential Functions (numbered), Compliance-Specific Duties, Qualifications (Required/Preferred), Physical Requirements, and EEO Statement.`,
    contract_addendum: `Generate a contract addendum. Include: Reference to Original Agreement, Parties, Effective Date, Specific Modifications (numbered), Rationale for Changes, Impact on Other Terms, Signature Blocks, and Integration Clause.`,
    talking_points: `Generate leadership talking points/briefing. Include: Topic Overview (2-3 sentences), Key Messages (bulleted, quotable), Supporting Data Points, Anticipated Questions with Suggested Responses, Background Context, and Recommended Next Steps.`,
  };
  return instructions[docType] || instructions.policy;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { topic, industry, standards, accreditations, standardsHint, tone, advancedPrompt, docType, audience, lengthPreference, includeSections, customInstructions } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let orgContext = "";
    try { orgContext = await fetchOrgPolicySummary(); } catch (e) { console.error("Context fetch failed:", e); }

    const docTypeInstruction = getDocTypeInstructions(docType || "policy");
    const isManualWorthy = ["policy", "procedure", "sop", "plan", "form", "checklist", "report_template"].includes(docType || "policy");

    const systemPrompt = `You are a healthcare compliance and regulatory document expert.\n\n${docTypeInstruction}\n\nRequirements:\n- Clear, enforceable language\n- Written for a healthcare organization\n- Professional, neutral tone\n- No unnecessary legal citations unless requested\n- Avoid vague language like "may" or "should" unless intentional\n- Keep language precise, operational, and audit-ready\n\nHere is context about this organization's existing policies and compliance program:\n\n${orgContext}\n\nWhen generating documents:\n- Reference existing policies by name where relevant\n- Ensure consistency with the organization's current policy structure\n- Avoid duplicating content from existing policies — cross-reference instead\n- Align with tracked accrediting bodies and standards\n\n${isManualWorthy ? `\n═══════════════════════════════════════════════════════════════\nMANDATORY TEMPLATE — FOLLOW THIS EXACT STRUCTURE.\nDO NOT SKIP SECTIONS. DO NOT REARRANGE.\n═══════════════════════════════════════════════════════════════\n\nCRITICAL: Do NOT include any metadata header table, logo placeholder, policy number table, dates table, or any introductory preamble. Start DIRECTLY with the first section heading below.\n\n**POLICY TITLE**\nThe formal title.\n\n**PURPOSE**\nWhy this document exists. 2-3 sentences minimum.\n\n**SCOPE**\nWho this applies to and which facilities/locations.\n\n**DEFINITIONS**\nKey terms. Minimum 5-8 definitions. Format:\n- **[Term]**: [Definition]\n\n**POLICY STATEMENT**\nCore commitments and requirements. "[Organization Name] shall..."\n\n**PROCEDURES**\nLongest section. Detailed step-by-step procedures with lettered/numbered sub-sections.\n\n**ROLES & RESPONSIBILITIES**\nEach role and duties.\n\n**DOCUMENTATION REQUIREMENTS**\nRecords to maintain, retention periods, storage locations.\n\n**ENFORCEMENT / NON-COMPLIANCE**\nConsequences. Progressive discipline. Regulatory penalties.\n\n**REVIEW AND REVISION SCHEDULE**\nReview frequency, responsible parties, update process.\n\n**REFERENCES**\nReal regulatory citations. Minimum 5 references.\n\n**RELATED POLICIES**\nCross-references to existing organizational policies.\n` : `\nCRITICAL: Do NOT include any introductory sentence like "I'll generate..." — go straight into the document content.\n`}\n\n═══════════════════════════════════════════════════════════════\nFORMATTING RULES:\n- Use formal, professional language throughout\n- Use [Organization Name] as a placeholder\n- Every section must have real content — NO "TBD" or "[Insert here]" for content\n- Write in clean markdown\n- Do NOT include any page footer\n═══════════════════════════════════════════════════════════════`;

    const userPrompt = advancedPrompt
      ? `${advancedPrompt}\n\nTopic: ${topic}\nIndustry: ${industry || "Healthcare"}\nStandards: ${standardsHint || "Auto-detect"}\nTone: ${tone || "Professional and formal"}\nDocument Type: ${docType || "policy"}\nTarget Audience: ${audience || "all-workforce"}\nLength: ${lengthPreference || "comprehensive"}${includeSections?.length ? `\nInclude these sections: ${includeSections.join(", ")}` : ""}${customInstructions ? `\n\nAdditional Instructions: ${customInstructions}` : ""}`
      : `Generate a ${docType || "policy"} document for:\nTopic: ${topic}\nIndustry: ${industry || "General"}\nStandards/Accreditations: ${standardsHint || (standards || []).join(", ") || "Auto-detect based on topic and industry"}\nTone: ${tone || "Professional and formal"}\nTarget Audience: ${audience || "all-workforce"}\nDesired Length: ${lengthPreference || "comprehensive"}${includeSections?.length ? `\nInclude these sections: ${includeSections.join(", ")}` : ""}${customInstructions ? `\n\nAdditional Instructions: ${customInstructions}` : ""}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        stream: true,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits to continue." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "AI service error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(response.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("policy-generate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
