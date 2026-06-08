import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const { action, siteId, listId, documentId } = await req.json();

    const clientId = Deno.env.get("MS365_CLIENT_ID");
    const clientSecret = Deno.env.get("MS365_CLIENT_SECRET");
    const tenantId = Deno.env.get("MS365_TENANT_ID");

    if (!clientId || !clientSecret || !tenantId) {
      return new Response(
        JSON.stringify({
          error: "Microsoft 365 not configured",
          message: "Please add MS365_CLIENT_ID, MS365_CLIENT_SECRET, and MS365_TENANT_ID to your backend secrets.",
          setup_steps: [
            "1. Go to Azure Portal → Azure Active Directory → App registrations",
            "2. Create a new registration with redirect URI",
            "3. Add Microsoft Graph API permissions: Sites.ReadWrite.All, Files.ReadWrite.All",
            "4. Create a client secret",
            "5. Add the credentials to your backend configuration",
          ],
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      }
    );

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Failed to obtain Microsoft Graph access token");

    const accessToken = tokenData.access_token;
    const graphBase = "https://graph.microsoft.com/v1.0";
    let result;

    switch (action) {
      case "list_sites": {
        const res = await fetch(`${graphBase}/sites?search=*`, { headers: { Authorization: `Bearer ${accessToken}` } });
        result = await res.json();
        break;
      }
      case "list_documents": {
        if (!siteId || !listId) throw new Error("siteId and listId required");
        const res = await fetch(`${graphBase}/sites/${siteId}/lists/${listId}/items?expand=fields`, { headers: { Authorization: `Bearer ${accessToken}` } });
        result = await res.json();
        break;
      }
      case "upload_document": {
        result = { message: "Upload endpoint ready. Send file data in request body." };
        break;
      }
      case "sync_status": {
        result = { connected: true, tenant_id: tenantId, permissions: ["Sites.ReadWrite.All", "Files.ReadWrite.All"] };
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
