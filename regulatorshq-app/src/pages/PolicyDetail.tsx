import { useState, useEffect } from "react";
import { sanitizeHtml } from "@/lib/sanitize";
import { useParams, Link, useNavigate } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { DOC_TYPE_LABELS, type PolicyStatus } from "@/types/policy";
import { Calendar, User, Tag, Shield, Clock, FileText, CheckCircle2, Edit2, Play, RotateCcw, ThumbsUp, Globe, Loader2, File, Eye, Download, ShieldCheck, AlertTriangle, ExternalLink, Sparkles } from "lucide-react";
import { InlineAIAction } from "@/components/InlineAIAction";
import { exportPolicyAsDocx } from "@/lib/export-docx";
import { DOC_TYPE_LABELS as DOC_LABELS_EXPORT } from "@/types/policy";
import { AIPolicySummary } from "@/components/AIPolicySummary";
import { ESignaturePad } from "@/components/ESignaturePad";
import { CompetencyQuiz } from "@/components/CompetencyQuiz";
import { ApprovalWorkflowTracker } from "@/components/ApprovalWorkflowTracker";
import { PolicyVersionHistory } from "@/components/PolicyVersionHistory";
import { PolicyDocumentHeader } from "@/components/PolicyDocumentHeader";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { ContradictionAlert } from "@/components/ContradictionAlert";
import PolicyStudio from "@/components/PolicyStudio";

function mapStatus(s: string): PolicyStatus {
  const map: Record<string, PolicyStatus> = {
    draft: "draft", pending_review: "in_review", in_review: "in_review",
    approved: "approved", published: "published", archived: "archived",
  };
  return map[s] || "draft";
}

export default function PolicyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [policy, setPolicy] = useState<any>(null);
  const [latestVersion, setLatestVersion] = useState<any>(null);
  const [workflowStatus, setWorkflowStatus] = useState<PolicyStatus>("draft");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showReviewers, setShowReviewers] = useState(false);
  const [reviewerName, setReviewerName] = useState("");
  const [approverName, setApproverName] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [loadingPolicy, setLoadingPolicy] = useState(true);

  useEffect(() => {
    if (id) fetchLatestVersion();
  }, [id]);

  const fetchLatestVersion = async () => {
    const { data } = await supabase
      .from("policy_versions")
      .select("*")
      .eq("policy_id", id!)
      .order("version_number", { ascending: false })
      .limit(1);
    if (data?.[0]) {
      const v = data[0] as any;
      setLatestVersion(v);
      const dbPolicy = {
        id: id!,
        title: v.title,
        doc_type: v.doc_type || "policy",
        category: v.category || "General",
        status: mapStatus(v.status),
        owner: v.created_by || "Unknown",
        effective_date: v.effective_date || "",
        last_updated: v.created_at?.split("T")[0] || "",
        review_interval_months: 12,
        next_review_date: "",
        standards: [] as string[],
        tags: [] as string[],
        attestation_rate: 0,
      };
      setPolicy(dbPolicy);
      setWorkflowStatus(dbPolicy.status);
    }
    setLoadingPolicy(false);
  };

  if (loadingPolicy) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Policy not found.</p>
        <Link to="/policies" className="text-accent text-sm mt-2 hover:underline">← Back to policies</Link>
      </div>
    );
  }

  // MCN-style workflow actions
  const submitForReview = async () => {
    setActionLoading("submit");
    await supabase.from("approval_workflows").insert({
      policy_id: id!, version_number: latestVersion?.version_number || 1,
      initiated_by: policy.owner, workflow_type: "standard", status: "in_review",
    });
    if (latestVersion) {
      await supabase.from("policy_versions").update({ status: "in_review" }).eq("id", latestVersion.id);
    }
    await supabase.from("audit_log").insert({
      entity_type: "policy", entity_id: id!, action: "submitted_for_review",
      actor: policy.owner, details: { title: policy.title },
    });
    setWorkflowStatus("in_review");
    setActionLoading(null);
    toast({ title: "Submitted for review", description: "Policy has been routed to reviewers." });
  };

  const routeForApproval = async () => {
    setActionLoading("route_approval");
    const { data: workflows } = await supabase.from("approval_workflows")
      .select("*").eq("policy_id", id!).order("initiated_at", { ascending: false }).limit(1);
    if (workflows?.[0]) {
      await supabase.from("approval_workflows").update({ status: "pending_approval" }).eq("id", workflows[0].id);
      await supabase.from("approval_steps").insert({
        workflow_id: workflows[0].id, step_name: "Department Approval",
        step_order: 1, approver: approverName || "Compliance Officer", status: "pending",
      });
    }
    await supabase.from("audit_log").insert({
      entity_type: "policy", entity_id: id!, action: "routed_for_approval",
      actor: "Reviewer", details: { approver: approverName || "Compliance Officer" },
    });
    setWorkflowStatus("approved");
    setActionLoading(null);
    toast({ title: "Routed for approval", description: "Policy sent to approvers." });
  };

  const approvePolicy = async () => {
    setActionLoading("approve");
    const { data: workflows } = await supabase.from("approval_workflows")
      .select("*, approval_steps(*)").eq("policy_id", id!).order("initiated_at", { ascending: false }).limit(1);
    if (workflows?.[0]) {
      await supabase.from("approval_workflows").update({ status: "approved" }).eq("id", workflows[0].id);
      const pendingSteps = workflows[0].approval_steps?.filter((s: any) => s.status === "pending");
      for (const step of pendingSteps || []) {
        await supabase.from("approval_steps").update({ status: "approved", acted_at: new Date().toISOString() }).eq("id", step.id);
      }
    }
    if (latestVersion) {
      await supabase.from("policy_versions").update({ status: "approved" }).eq("id", latestVersion.id);
    }
    await supabase.from("audit_log").insert({
      entity_type: "policy", entity_id: id!, action: "approved",
      actor: "Approver", details: { title: policy.title },
    });
    setWorkflowStatus("approved");
    setActionLoading(null);
    toast({ title: "Policy approved", description: "Ready to publish." });
  };

  const publishPolicy = async () => {
    setActionLoading("publish");
    const { data: workflows } = await supabase.from("approval_workflows")
      .select("*").eq("policy_id", id!).order("initiated_at", { ascending: false }).limit(1);
    if (workflows?.[0]) {
      await supabase.from("approval_workflows").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", workflows[0].id);
    }
    if (latestVersion) {
      await supabase.from("policy_versions").update({ status: "published", effective_date: new Date().toISOString().split("T")[0] }).eq("id", latestVersion.id);
    }
    await supabase.from("policy_versions")
      .update({ status: "archived" })
      .eq("policy_id", id!)
      .neq("id", latestVersion?.id || "")
      .eq("status", "published");
    await supabase.from("audit_log").insert({
      entity_type: "policy", entity_id: id!, action: "published",
      actor: policy.owner, details: { title: policy.title, version: latestVersion?.version_number },
    });
    // Auto-schedule review cycle
    const reviewIntervalMonths = policy.review_interval_months || 12;
    const nextReviewDate = new Date();
    nextReviewDate.setMonth(nextReviewDate.getMonth() + reviewIntervalMonths);
    const nextReviewStr = nextReviewDate.toISOString().split("T")[0];

    await Promise.all([
      supabase.from("review_cycles").insert({
        policy_id: id!,
        reviewer: policy.owner,
        review_type: "scheduled",
        status: "pending",
        review_date: nextReviewStr,
        next_review_date: nextReviewStr,
      }),
      supabase.from("compliance_calendar").insert({
        title: `Review: ${policy.title}`,
        category: "review",
        due_date: nextReviewStr,
        status: "pending",
        recurrence: reviewIntervalMonths <= 6 ? "semi-annually" : "annually",
        description: `Scheduled review for "${policy.title}" (v${latestVersion?.version_number || 1}). Review interval: ${reviewIntervalMonths} months.`,
        related_policy_id: id!,
        assigned_to: policy.owner,
      }),
      supabase.from("audit_log").insert({
        entity_type: "policy", entity_id: id!, action: "review_scheduled",
        actor: "System", details: { next_review_date: nextReviewStr, interval_months: reviewIntervalMonths },
      }),
    ]);

    setWorkflowStatus("published");
    setActionLoading(null);
    toast({ title: "Policy published!", description: `Auto-review scheduled for ${nextReviewStr}. Previous versions archived.` });

    // Auto-trigger contradiction scan in background (fire-and-forget)
    try {
      const { data: otherPolicies } = await supabase
        .from("policy_versions")
        .select("title, content, category, policy_id")
        .eq("status", "published")
        .neq("policy_id", id!)
        .limit(30);
      const summaries = (otherPolicies || [])
        .map(p => `**${p.title}** (${p.category}): ${(p.content || "").slice(0, 400)}`)
        .join("\n\n");
      // Non-streaming check — just log to audit if contradictions found
      const scanResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/contradiction-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ policyId: id!, policyTitle: policy.title, policyContent: latestVersion?.content?.slice(0, 3000), allPolicySummaries: summaries }),
      });
      if (scanResp.ok) {
        // Read the stream to completion
        const reader = scanResp.body?.getReader();
        const decoder = new TextDecoder();
        let scanResult = "";
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            // Extract content from SSE
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const json = line.slice(6).trim();
              if (json === "[DONE]") continue;
              try { scanResult += JSON.parse(json).choices?.[0]?.delta?.content || ""; } catch {}
            }
          }
        }
        const hasIssues = scanResult && !scanResult.toLowerCase().includes("no contradictions");
        if (hasIssues) {
          await supabase.from("audit_log").insert({
            entity_type: "policy", entity_id: id!, action: "contradiction_detected",
            actor: "System", details: { summary: scanResult.slice(0, 500) },
          });
          toast({ title: "⚠️ Potential contradictions detected", description: "Scroll down to the Contradiction Scanner for details.", variant: "destructive" });
        }
      }
    } catch (e) { console.warn("Auto contradiction scan failed:", e); }
  };

  const returnForRevision = async () => {
    setActionLoading("return");
    if (latestVersion) {
      await supabase.from("policy_versions").update({ status: "draft" }).eq("id", latestVersion.id);
    }
    await supabase.from("audit_log").insert({
      entity_type: "policy", entity_id: id!, action: "returned_for_revision",
      actor: "Reviewer", details: { comment: returnComment, title: policy.title },
    });
    setWorkflowStatus("draft");
    setShowReturnForm(false);
    setReturnComment("");
    setActionLoading(null);
    toast({ title: "Returned for revision" });
  };

  const getActions = () => {
    switch (workflowStatus) {
      case "draft":
        return (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigate(`/policies/${id}/edit`)} className="inline-flex items-center gap-2 px-4 py-2 border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              <Edit2 className="w-4 h-4" /> Edit Policy
            </button>
            <button onClick={submitForReview} disabled={!!actionLoading} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {actionLoading === "submit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Submit for Review
            </button>
          </div>
        );
      case "in_review":
        return (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowReturnForm(true)} className="inline-flex items-center gap-2 px-4 py-2 border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              <RotateCcw className="w-4 h-4" /> Return for Revision
            </button>
            <button onClick={routeForApproval} disabled={!!actionLoading} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {actionLoading === "route_approval" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />} Route for Approval
            </button>
          </div>
        );
      case "approved":
        return (
          <div className="flex gap-2">
            <button onClick={publishPolicy} disabled={!!actionLoading} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {actionLoading === "publish" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Publish
            </button>
          </div>
        );
      case "published":
        return (
          <div className="flex gap-2">
            <button onClick={() => navigate(`/policies/${id}/edit`)} className="inline-flex items-center gap-2 px-4 py-2 border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors">
              <Edit2 className="w-4 h-4" /> Create New Version
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl px-4 sm:px-6 py-3">
      <div className="space-y-4">

      <div className="bg-card rounded-lg border border-border shadow-card p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status={workflowStatus} />
              <span className="text-xs text-muted-foreground px-2 py-0.5 rounded bg-secondary">{DOC_TYPE_LABELS[policy.doc_type]}</span>
            </div>
            <h1 className="text-xl font-bold text-foreground">{policy.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {getActions()}
            <button
              onClick={() =>
                exportPolicyAsDocx({
                  title: policy.title, category: policy.category,
                  docType: DOC_LABELS_EXPORT[policy.doc_type], owner: policy.owner,
                  effectiveDate: policy.effective_date || "Pending",
                  version: latestVersion?.version_number || 1,
                  reviewInterval: policy.review_interval_months,
                  nextReviewDate: policy.next_review_date || "TBD",
                  standards: policy.standards, content: latestVersion?.content,
                })
              }
              className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 border border-border text-xs sm:text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              <Download className="w-4 h-4" /> <span className="hidden sm:inline">Download</span> .docx
            </button>
          </div>
        </div>

        {showReturnForm && (
          <div className="mb-6 p-4 bg-muted/50 rounded-lg border border-border">
            <p className="text-sm font-medium text-foreground mb-2">Return for Revision</p>
            <textarea
              value={returnComment} onChange={(e) => setReturnComment(e.target.value)}
              placeholder="Explain what needs to be revised..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px]"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={returnForRevision} disabled={!!actionLoading} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {actionLoading === "return" ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null} Send Back
              </button>
              <button onClick={() => setShowReturnForm(false)} className="px-4 py-2 border border-border text-sm text-foreground hover:bg-secondary">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Tag, label: "Category", value: policy.category },
            { icon: User, label: "Owner", value: policy.owner },
            { icon: Calendar, label: "Effective Date", value: policy.effective_date || "Not set" },
            { icon: Clock, label: "Last Updated", value: policy.last_updated },
            { icon: Clock, label: "Review Interval", value: `${policy.review_interval_months} months` },
            { icon: Calendar, label: "Next Review", value: policy.next_review_date || "Not set" },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <item.icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{item.label}</p>
                <p className="text-sm font-medium text-foreground">{item.value}</p>
              </div>
            </div>
          ))}
        </div>

        {policy.standards.length > 0 && (
          <div className="mt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> Compliance Standards
            </p>
            <div className="flex flex-wrap gap-2">
              {policy.standards.map((s: string) => (
                <span key={s} className="inline-flex px-2.5 py-1 rounded-md text-xs font-medium bg-accent/10 text-accent">{s}</span>
              ))}
            </div>
          </div>
        )}

        {policy.tags.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {policy.tags.map((t: string) => (
                <span key={t} className="inline-flex px-2 py-0.5 rounded text-[11px] bg-secondary text-secondary-foreground">{t}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <ApprovalWorkflowTracker status={workflowStatus} />

      {/* Policy Studio — NotebookLM-style (top priority) */}
      {latestVersion?.content && (
        <div className="bg-card rounded-lg border border-border shadow-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" /> Policy Studio
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Deep dive conversation, slides, study guide, briefing doc, and quiz — all generated from this policy.
          </p>
          <PolicyStudio
            policyTitle={policy.title}
            policyContent={latestVersion.content}
            policyCategory={policy.category}
          />
        </div>
      )}

      <div className="bg-card rounded-lg border border-border shadow-card p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Eye className="w-4 h-4 text-accent" /> Document Preview
        </h3>
        {(() => {
          const fileUrl = latestVersion?.file_url;
          const isPdf = fileUrl && (latestVersion.file_type === "application/pdf" || fileUrl.toLowerCase().endsWith(".pdf"));
          const isInternal = fileUrl && fileUrl.includes("supabase");
          const isOtherFile = fileUrl && latestVersion.file_type && !isPdf;
          const contentIsShort = !latestVersion?.content || latestVersion.content.replace(/<[^>]*>/g, "").length < 500;

          // External PDF — embed via proxy with proper sizing
          if (isPdf && !isInternal) {
            const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pdf-proxy?url=${encodeURIComponent(fileUrl)}`;
            return (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Viewing: {latestVersion?.title || "Policy Document"}</p>
                  <div className="flex items-center gap-2">
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors">
                      <ExternalLink className="w-3.5 h-3.5" /> Open Original
                    </a>
                    <a href={proxyUrl} download className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors">
                      <Download className="w-3.5 h-3.5" /> Download PDF
                    </a>
                  </div>
                </div>
                <div className="relative w-full" style={{ height: 'calc(100vh - 200px)', minHeight: '500px', maxHeight: '1000px' }}>
                  <iframe src={proxyUrl} className="absolute inset-0 w-full h-full rounded-lg border border-border" title="Policy Document" />
                </div>
              </div>
            );
          }

          // Internal PDF — embed directly
          if (isPdf && isInternal) {
            return (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Viewing original PDF document</p>
                  <div className="flex items-center gap-2">
                    <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors">
                      <ExternalLink className="w-3.5 h-3.5" /> Open in New Tab
                    </a>
                    <a href={fileUrl} download className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors">
                      <Download className="w-3.5 h-3.5" /> Download PDF
                    </a>
                  </div>
                </div>
                <div className="relative w-full" style={{ height: 'calc(100vh - 200px)', minHeight: '500px', maxHeight: '1000px' }}>
                  <iframe src={fileUrl} className="absolute inset-0 w-full h-full rounded-lg border border-border" title="Policy Document" />
                </div>
              </div>
            );
          }

          if (isOtherFile && isInternal) {
            return (
              <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-accent hover:underline text-sm">
                <File className="w-4 h-4" /> {latestVersion.file_name || "Download Document"}
              </a>
            );
          }

          // Paper preview with authored content
          return (
            <div>
              {fileUrl && (
                <div className="mb-4 p-3 rounded-lg bg-muted/50 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Original document available</span>
                  <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-accent hover:underline text-sm font-medium">
                    <ExternalLink className="w-4 h-4" /> View Original PDF
                  </a>
                </div>
              )}
              <div className="mx-auto max-w-[816px] w-full rounded border border-border">
                <div className="bg-card w-full">
                  <div className="px-4 sm:px-12 py-6 sm:py-10 text-foreground" style={{ fontFamily: "'Times New Roman', Georgia, serif" }}>
                    <PolicyDocumentHeader
                      title={policy.title}
                      category={policy.category}
                      docType={DOC_TYPE_LABELS[policy.doc_type]}
                      effectiveDate={policy.effective_date}
                      lastReviewedDate={policy.last_updated}
                      preparedBy={policy.owner}
                      version={latestVersion?.version_number || 1}
                    />
                    {latestVersion?.content ? (
                      <div className="prose prose-sm max-w-none text-foreground leading-relaxed" style={{ fontSize: 13, lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(latestVersion.content) }} />
                    ) : (
                      <div className="text-center py-20">
                        <p className="text-sm text-muted-foreground">No content body yet.</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Edit this policy to add content or upload a document.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* AI Quick Review */}
      {latestVersion?.content && (
        <div className="bg-card rounded-lg border border-border shadow-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent" /> AI Compliance Review
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Scan this policy for regulatory gaps, missing sections, and compliance issues against HIPAA, TJC, CMS, and other frameworks.
          </p>
          <InlineAIAction
            label="Quick Review"
            functionName="inline-ai"
            body={{
              mode: "policy-compliance-review",
              prompt: `You are a healthcare compliance auditor. Perform a quick compliance review of this policy and identify gaps, missing required sections, regulatory risks, and improvement areas.\n\nPolicy Title: ${policy.title}\nStatus: ${workflowStatus}\nCategory: ${policy.category}\n\nPolicy Content:\n${latestVersion.content.replace(/<[^>]*>/g, "").slice(0, 6000)}`,
            }}
          />
        </div>
      )}

      <AIPolicySummary policyTitle={policy.title} policyContent={latestVersion?.content} />


      {/* Contradiction Alerts */}
      <div className="bg-card rounded-lg border border-border shadow-card p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-accent" /> Contradiction Scanner
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          AI-powered scan to detect conflicts between this policy and other published policies in your library.
        </p>
        <ContradictionAlert
          policyId={id!}
          policyTitle={policy.title}
          policyContent={latestVersion?.content}
        />
      </div>

      <PolicyVersionHistory policyId={id!} policyTitle={policy.title} />
      </div>
    </div>
  );
}