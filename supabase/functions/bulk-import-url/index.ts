import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { url, title, policy_number, category, doc_type } = await req.json();

    if (!url) throw new Error("URL is required");

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlKey) throw new Error("FIRECRAWL_API_KEY not configured");

    console.log(`Scraping via Firecrawl: ${title || url}`);

    // Use Firecrawl to scrape the PDF — bypasses bot protection / 403s
    const scrapeResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        waitFor: 3000,
      }),
    });

    const scrapeData = await scrapeResp.json();

    if (!scrapeResp.ok) {
      console.error("Firecrawl error:", scrapeData);
      throw new Error(`Firecrawl failed: ${scrapeData.error || scrapeResp.status}`);
    }

    // Extract text from Firecrawl response
    const text = scrapeData?.data?.markdown || scrapeData?.markdown || "";
    console.log(`Extracted ${text.length} chars via Firecrawl`);

    if (!text || text.length < 50) {
      throw new Error("Firecrawl returned insufficient text content");
    }

    // Determine policy_id from policy number
    const policyId = policy_number || title?.match(/\d{3}\.\d{2}/)?.[0] || crypto.randomUUID();

    // Insert into policy_versions
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if policy already exists
    const { data: existing } = await supabase
      .from("policy_versions")
      .select("id")
      .eq("policy_id", policyId)
      .eq("version_number", 1)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, policy_id: policyId, message: "Already exists" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanTitle = title || `Policy ${policyId}`;

    const { data, error } = await supabase.from("policy_versions").insert({
      policy_id: policyId,
      title: cleanTitle,
      content: text.substring(0, 50000),
      version_number: 1,
      status: "published",
      category: category || "Corporate Compliance",
      doc_type: doc_type || "policy",
      created_by: "Bulk Import",
      effective_date: new Date().toISOString().split("T")[0],
      file_url: url,
      file_name: url.split("/").pop() || `${policyId}.pdf`,
      file_type: "application/pdf",
    }).select().single();

    if (error) throw error;

    console.log(`Inserted policy ${policyId}: ${cleanTitle}`);

    return new Response(
      JSON.stringify({
        success: true,
        policy_id: policyId,
        title: cleanTitle,
        text_length: text.length,
        id: data.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("bulk-import-url error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Import failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
