import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationPayload {
  type: "review_reminder" | "approval_request" | "attestation_deadline" | "policy_published";
  recipients: { name: string; email: string }[];
  policyTitle: string;
  dueDate?: string;
  message?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const payload: NotificationPayload = await req.json();
    
    // Log the notification (in production, integrate with Resend or similar)
    console.log(`[Notification] Type: ${payload.type}`);
    console.log(`[Notification] Policy: ${payload.policyTitle}`);
    console.log(`[Notification] Recipients: ${payload.recipients.map(r => r.email).join(", ")}`);
    
    // Build notification record
    const notifications = payload.recipients.map(r => ({
      type: payload.type,
      recipient_name: r.name,
      recipient_email: r.email,
      policy_title: payload.policyTitle,
      due_date: payload.dueDate || null,
      message: payload.message || getDefaultMessage(payload.type, payload.policyTitle),
      sent_at: new Date().toISOString(),
      status: "queued",
    }));

    // In a production setup, this would send via Resend/SendGrid
    // For now, we log and return success for the notification system
    return new Response(
      JSON.stringify({ 
        success: true, 
        queued: notifications.length,
        message: "Notifications queued. Configure an email provider (Resend) to enable delivery.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function getDefaultMessage(type: string, policyTitle: string): string {
  switch (type) {
    case "review_reminder":
      return `The policy "${policyTitle}" is due for review. Please review and update as needed.`;
    case "approval_request":
      return `The policy "${policyTitle}" requires your approval. Please review and approve or provide feedback.`;
    case "attestation_deadline":
      return `You have a pending attestation for "${policyTitle}". Please review and sign the policy.`;
    case "policy_published":
      return `The policy "${policyTitle}" has been published. Please review the latest version.`;
    default:
      return `Notification regarding "${policyTitle}".`;
  }
}
