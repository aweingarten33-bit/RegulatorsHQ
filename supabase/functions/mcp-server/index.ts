import { Hono } from "jsr:@hono/hono@^4";
import { McpServer, StreamableHttpTransport } from "npm:mcp-lite@^0.10.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

// PHI-safe: Strip fields that could contain PHI
function sanitize<T extends Record<string, unknown>>(
  rows: T[],
  removeFields: string[] = []
): T[] {
  const phiFields = [
    "reporter_name", "reporter_contact", "employee_email", "ip_address",
    "signature_data", "staff_answer", "email", "contact_email", "contact_name",
    "reporter_email", "interviewee_name", "notes", "follow_up_notes",
    ...removeFields,
  ];
  return rows.map((row) => {
    const clean = { ...row };
    for (const f of phiFields) {
      if (f in clean) delete clean[f];
    }
    return clean;
  });
}

const app = new Hono();

const mcpServer = new McpServer({
  name: "regulators-hq",
  version: "1.0.0",
});

// ── TOOL: List policies ──
mcpServer.tool({
  name: "list_policies",
  description: "List all policies with their latest version info. Returns title, status, category, version number, effective date. No PHI included.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter by status: draft, pending_review, approved, archived" },
      category: { type: "string", description: "Filter by category" },
      limit: { type: "number", description: "Max results (default 50)" },
    },
  },
  handler: async ({ status, category, limit }: { status?: string; category?: string; limit?: number }) => {
    const sb = getSupabase();
    let q = sb.from("policy_versions").select("policy_id, title, status, category, version_number, effective_date, doc_type, created_at")
      .order("created_at", { ascending: false })
      .limit(limit || 50);
    if (status) q = q.eq("status", status);
    if (category) q = q.eq("category", category);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ── TOOL: Get policy content ──
mcpServer.tool({
  name: "get_policy",
  description: "Get full content of a specific policy by policy_id. Returns the latest version's content, title, status.",
  inputSchema: {
    type: "object",
    properties: {
      policy_id: { type: "string", description: "The policy_id to retrieve" },
    },
    required: ["policy_id"],
  },
  handler: async ({ policy_id }: { policy_id: string }) => {
    const sb = getSupabase();
    const { data, error } = await sb.from("policy_versions")
      .select("policy_id, title, content, status, version_number, effective_date, category, change_summary")
      .eq("policy_id", policy_id)
      .order("version_number", { ascending: false })
      .limit(1);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    if (!data?.length) return { content: [{ type: "text", text: "Policy not found." }] };
    const p = data[0];
    // Strip HTML from content for clean text
    const text = p.content?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || "(no content)";
    return { content: [{ type: "text", text: JSON.stringify({ ...p, content: text }, null, 2) }] };
  },
});

// ── TOOL: Search policies ──
mcpServer.tool({
  name: "search_policies",
  description: "Search policies by keyword in title or content.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keyword" },
    },
    required: ["query"],
  },
  handler: async ({ query }: { query: string }) => {
    const sb = getSupabase();
    const { data, error } = await sb.from("policy_versions")
      .select("policy_id, title, status, category, version_number")
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ── TOOL: List investigations ──
mcpServer.tool({
  name: "list_investigations",
  description: "List compliance investigations. Returns case number, title, status, priority, stage, category. PHI fields are stripped.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter: open, closed, in_progress" },
      limit: { type: "number", description: "Max results (default 25)" },
    },
  },
  handler: async ({ status, limit }: { status?: string; limit?: number }) => {
    const sb = getSupabase();
    let q = sb.from("investigations")
      .select("id, case_number, title, status, priority, stage, category, source, created_at, assigned_to")
      .order("created_at", { ascending: false })
      .limit(limit || 25);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ── TOOL: List hotline reports ──
mcpServer.tool({
  name: "list_hotline_reports",
  description: "List compliance hotline reports with status, category, priority. Reporter identity is stripped for PHI safety.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter: new, under_review, resolved, closed" },
      limit: { type: "number", description: "Max results (default 25)" },
    },
  },
  handler: async ({ status, limit }: { status?: string; limit?: number }) => {
    const sb = getSupabase();
    let q = sb.from("hotline_reports")
      .select("id, report_number, case_key, category, status, priority, description, is_anonymous, assigned_to, created_at")
      .order("created_at", { ascending: false })
      .limit(limit || 25);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(sanitize(data || []), null, 2) }] };
  },
});

// ── TOOL: Compliance calendar ──
mcpServer.tool({
  name: "list_calendar_items",
  description: "List compliance calendar deadlines and tasks with due dates, status, and category.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter: pending, completed, overdue" },
      limit: { type: "number", description: "Max results (default 30)" },
    },
  },
  handler: async ({ status, limit }: { status?: string; limit?: number }) => {
    const sb = getSupabase();
    let q = sb.from("compliance_calendar")
      .select("id, title, description, category, due_date, status, recurrence, assigned_to, completed_at")
      .order("due_date", { ascending: true })
      .limit(limit || 30);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ── TOOL: Risk assessments ──
mcpServer.tool({
  name: "list_risk_assessments",
  description: "List risk assessments with scores, categories, mitigation plans, and status.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter: open, mitigated, closed" },
    },
  },
  handler: async ({ status }: { status?: string }) => {
    const sb = getSupabase();
    let q = sb.from("risk_assessments")
      .select("id, title, description, risk_category, risk_level, risk_score, likelihood, impact, status, owner, department, mitigation_plan, due_date")
      .order("risk_score", { ascending: false })
      .limit(50);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ── TOOL: Training completion ──
mcpServer.tool({
  name: "training_stats",
  description: "Get training completion statistics by department. No individual employee data — aggregated only.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const sb = getSupabase();
    const { data, error } = await sb.from("training_records")
      .select("department, completion_status, training_type");
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    const stats: Record<string, { total: number; completed: number; in_progress: number }> = {};
    for (const r of data || []) {
      const dept = r.department || "Unknown";
      if (!stats[dept]) stats[dept] = { total: 0, completed: 0, in_progress: 0 };
      stats[dept].total++;
      if (r.completion_status === "completed") stats[dept].completed++;
      if (r.completion_status === "in_progress") stats[dept].in_progress++;
    }
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  },
});

// ── TOOL: Accreditation readiness ──
mcpServer.tool({
  name: "accreditation_readiness",
  description: "Get accreditation readiness stats — standards mapped, CAPA counts, survey findings.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const sb = getSupabase();
    const [standards, mappings, capas, findings] = await Promise.all([
      sb.from("standards_library").select("id, accrediting_body, chapter_code, chapter_name, is_critical").then(r => r.data || []),
      sb.from("policy_standard_mappings").select("standard_id, compliance_status").then(r => r.data || []),
      sb.from("capa_records").select("id, status, priority, capa_type").then(r => r.data || []),
      sb.from("survey_findings").select("id, status, severity").then(r => r.data || []),
    ]);
    const mappedIds = new Set(mappings.map(m => m.standard_id));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          total_standards: standards.length,
          mapped_standards: mappedIds.size,
          coverage_pct: standards.length ? Math.round((mappedIds.size / standards.length) * 100) : 0,
          open_capas: capas.filter(c => c.status !== "closed").length,
          open_findings: findings.filter(f => f.status !== "resolved" && f.status !== "verified").length,
          critical_standards: standards.filter(s => s.is_critical).length,
        }, null, 2),
      }],
    };
  },
});

// ── TOOL: Manuals overview ──
mcpServer.tool({
  name: "list_manuals",
  description: "List all policy manuals with their chapters and assigned policies.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const sb = getSupabase();
    const { data: manuals } = await sb.from("manuals").select("id, title, description, status, category");
    const { data: chapters } = await sb.from("manual_chapters").select("id, manual_id, title, sort_order");
    const { data: chapterPolicies } = await sb.from("manual_chapter_policies").select("chapter_id, policy_id, sort_order");
    const result = (manuals || []).map(m => ({
      ...m,
      chapters: (chapters || [])
        .filter(c => c.manual_id === m.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(c => ({
          title: c.title,
          policy_count: (chapterPolicies || []).filter(cp => cp.chapter_id === c.id).length,
        })),
    }));
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
});

// ── TOOL: Vendor overview ──
mcpServer.tool({
  name: "list_vendors",
  description: "List vendor records with risk levels, BAA status, and contract dates. Contact info is stripped.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter: active, inactive, pending" },
    },
  },
  handler: async ({ status }: { status?: string }) => {
    const sb = getSupabase();
    let q = sb.from("vendor_records")
      .select("id, vendor_name, vendor_type, status, risk_level, baa_required, baa_signed, contract_start, contract_end, exclusion_check_clear")
      .order("vendor_name");
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }] };
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
});

// ── TOOL: Compliance summary dashboard ──
mcpServer.tool({
  name: "compliance_summary",
  description: "Get a high-level compliance program summary: policy counts by status, open investigations, overdue calendar items, risk scores.",
  inputSchema: { type: "object", properties: {} },
  handler: async () => {
    const sb = getSupabase();
    const [policies, investigations, calendar, risks] = await Promise.all([
      sb.from("policy_versions").select("status").then(r => r.data || []),
      sb.from("investigations").select("status").then(r => r.data || []),
      sb.from("compliance_calendar").select("status, due_date").then(r => r.data || []),
      sb.from("risk_assessments").select("risk_score, status").then(r => r.data || []),
    ]);
    const policyCounts: Record<string, number> = {};
    for (const p of policies) { policyCounts[p.status] = (policyCounts[p.status] || 0) + 1; }
    const now = new Date().toISOString().split("T")[0];
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          policies: { total: policies.length, by_status: policyCounts },
          investigations: {
            total: investigations.length,
            open: investigations.filter(i => i.status === "open").length,
          },
          calendar: {
            total: calendar.length,
            overdue: calendar.filter(c => c.status === "pending" && c.due_date < now).length,
          },
          risks: {
            total: risks.length,
            open: risks.filter(r => r.status === "open").length,
            avg_score: risks.length ? Math.round(risks.reduce((s, r) => s + (r.risk_score || 0), 0) / risks.length) : 0,
          },
        }, null, 2),
      }],
    };
  },
});

const transport = new StreamableHttpTransport();

app.all("/*", async (c) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { user, error: authError } = await requireAuth(c.req.raw);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  const response = await transport.handleRequest(c.req.raw, mcpServer);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
});

Deno.serve(app.fetch);
