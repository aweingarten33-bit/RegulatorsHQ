import { useState, useRef, useEffect } from "react";
import { sanitizeHtml } from "@/lib/sanitize";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { RichTextEditor } from "@/components/RichTextEditor";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { CATEGORIES, DOC_TYPE_LABELS, type DocType } from "@/types/policy";
import { cn } from "@/lib/utils";
import {
  Save, Upload, FileText, X, File, Eye, Loader2, ArrowLeft,
  ChevronDown, Paperclip, PenLine,
} from "lucide-react";

export default function PolicyEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === "new";

  const templateTitle = searchParams.get("template") || "";
  const templateCategory = searchParams.get("category") || "HR";
  const templateDocType = (searchParams.get("doc_type") || "policy") as DocType;

  const [title, setTitle] = useState(templateTitle);
  const [docType, setDocType] = useState<DocType>(templateDocType);
  const [category, setCategory] = useState(templateCategory);
  const [owner, setOwner] = useState("");
  const [reviewInterval, setReviewInterval] = useState(12);
  const [content, setContent] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{ name: string; url: string; type: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(!isNew);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isNew && id) {
      const loadExisting = async () => {
        const { data } = await supabase
          .from("policy_versions")
          .select("*")
          .eq("policy_id", id)
          .order("version_number", { ascending: false })
          .limit(1);
        if (data?.[0]) {
          const v = data[0] as any;
          setTitle(v.title);
          setContent(v.content || "");
          setOwner(v.created_by || "");
          setChangeSummary(v.change_summary || "");
          if (v.doc_type) setDocType(v.doc_type);
          if (v.category) setCategory(v.category);
          if (v.file_url) {
            setUploadedFile({ name: v.file_name || "Document", url: v.file_url, type: v.file_type || "" });
          }
        }
        setLoadingExisting(false);
      };
      loadExisting();
    }
  }, [id, isNew]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Unsupported file type", description: "Please upload a PDF, Word, or text file.", variant: "destructive" });
      return;
    }
    setUploading(true);
    const fileName = `${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage.from("policy-documents").upload(fileName, file);
    if (error) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("policy-documents").getPublicUrl(data.path);
    setUploadedFile({ name: file.name, url: urlData.publicUrl, type: file.type });
    setUploading(false);
    toast({ title: "File uploaded", description: `${file.name} uploaded successfully.` });
  };

  const removeFile = () => {
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = async (asDraft = true) => {
    if (!title.trim()) {
      toast({ title: "Title required", description: "Please enter a policy title.", variant: "destructive" });
      return;
    }
    if (!asDraft && !owner.trim()) {
      toast({ title: "Policy Owner required", description: "A policy owner is required before submitting for review.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const policyId = isNew ? crypto.randomUUID() : id!;
    const { data: latestVersion } = await supabase
      .from("policy_versions")
      .select("version_number")
      .eq("policy_id", policyId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;
    const { error } = await supabase.from("policy_versions").insert({
      policy_id: policyId, version_number: nextVersionNumber,
      title: title.trim(), content: content || null,
      change_summary: changeSummary || null,
      status: asDraft ? "draft" : "pending_review",
      created_by: owner || "Current User",
      doc_type: docType,
      category: category,
      file_url: uploadedFile?.url || null,
      file_name: uploadedFile?.name || null,
      file_type: uploadedFile?.type || null,
    } as any);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    await supabase.from("audit_log").insert({
      entity_type: "policy", entity_id: policyId,
      action: isNew ? "policy_created" : "version_created",
      actor: owner || "Current User",
      details: { title, doc_type: docType, category, status: asDraft ? "draft" : "pending_review", version_number: nextVersionNumber },
    });
    setSaving(false);
    toast({ title: asDraft ? "Draft saved" : "Submitted for review", description: `"${title}" has been ${asDraft ? "saved as draft" : "submitted for review"}.` });
    navigate(`/policies/${policyId}`);
  };

  if (loadingExisting) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-3.5rem)] overflow-hidden flex flex-col px-4 sm:px-6 py-3">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
              showPreview
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/50"
            )}
          >
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Draft
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            Submit for Review
          </button>
        </div>
      </div>

      {/* Header */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
          {isNew ? "New Document" : "Editing"}
        </p>
        <h1 className="text-2xl md:text-3xl font-serif text-foreground tracking-tight leading-tight">
          {title || "Untitled Document"}
        </h1>
      </div>

      {showPreview ? (
        /* ── Preview Mode ── */
        <div className="bg-card rounded-lg border border-border shadow-card overflow-hidden">
          <div className="p-8 md:p-12">
            <div className="max-w-2xl mx-auto space-y-8">
              <div className="border-b border-border pb-6">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">
                  {DOC_TYPE_LABELS[docType]} · {category}
                </p>
                <h1 className="text-2xl font-serif text-foreground tracking-tight">{title || "Untitled Document"}</h1>
                <p className="text-xs text-muted-foreground mt-2">
                  Owner: {owner || "Not assigned"} · Review cycle: {reviewInterval} months
                </p>
              </div>
              {uploadedFile && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-3">Attachment</p>
                  {uploadedFile.type === "application/pdf" ? (
                    <div className="border border-border rounded-lg overflow-hidden" style={{ height: "700px" }}>
                      <iframe src={uploadedFile.url + "#toolbar=1&navpanes=0"} title="Policy Document" className="w-full h-full" style={{ border: "none" }} />
                    </div>
                  ) : (
                    <a href={uploadedFile.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs text-foreground hover:underline border border-border rounded-md px-4 py-3">
                      <File className="w-3.5 h-3.5" /> {uploadedFile.name}
                    </a>
                  )}
                </div>
              )}
              {content && <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} />}
              {!content && !uploadedFile && (
                <p className="text-sm text-muted-foreground text-center py-16">No content yet. Switch to edit mode to begin.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── Edit Mode ── */
        <div className="space-y-5">
          {/* Metadata card */}
          <div className="bg-card rounded-lg border border-border shadow-card p-5 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <PenLine className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Document Details</h2>
            </div>

            {/* Title */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold block mb-1.5">Document Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Information Security Policy"
                className="w-full px-3 py-2.5 rounded-md border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              />
            </div>

            {/* Grid fields */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold block mb-1.5">Type</label>
                <div className="relative">
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as DocType)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow appearance-none cursor-pointer"
                  >
                    {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold block mb-1.5">Category</label>
                <div className="relative">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow appearance-none cursor-pointer"
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold block mb-1.5">
                  Owner <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="e.g. Chief Compliance Officer"
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold block mb-1.5">Review (months)</label>
                <input
                  type="number"
                  value={reviewInterval}
                  onChange={(e) => setReviewInterval(Number(e.target.value))}
                  min={1}
                  max={60}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                />
              </div>
            </div>

            {/* Change summary */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold block mb-1.5">Change Summary</label>
              <input
                type="text"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="Brief description of changes in this version…"
                className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
              />
            </div>
          </div>

          {/* Attachment card */}
          <div className="bg-card rounded-lg border border-border shadow-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Paperclip className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attachment</h2>
            </div>

            {uploadedFile ? (
              <div className="flex items-center justify-between p-3 rounded-md bg-secondary/50 border border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <File className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{uploadedFile.name}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{uploadedFile.type}</p>
                  </div>
                </div>
                <button onClick={removeFile} className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg py-10 text-center cursor-pointer hover:border-muted-foreground/40 hover:bg-secondary/30 transition-all group"
              >
                {uploading ? (
                  <Loader2 className="w-5 h-5 text-muted-foreground mx-auto animate-spin" />
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-muted-foreground mx-auto mb-2 group-hover:text-foreground transition-colors" />
                    <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                      Drop file or click to browse
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">PDF, Word, or plain text</p>
                  </>
                )}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFileUpload} className="hidden" />
          </div>

          {/* Content editor card */}
          <div className="bg-card rounded-lg border border-border shadow-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Content</h2>
            </div>
            <RichTextEditor content={content} onChange={setContent} />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
