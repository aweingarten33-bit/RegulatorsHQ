import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const contentType = req.headers.get("content-type") || "";

    let fileBytes: Uint8Array;
    let fileName = "document";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) throw new Error("No file provided");
      fileName = file.name;
      fileBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      throw new Error("Expected multipart/form-data");
    }

    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    let text = "";

    if (ext === "pdf") {
      text = extractPdfText(fileBytes);
    } else if (ext === "docx") {
      text = await extractDocxText(fileBytes);
    } else if (ext === "doc") {
      text = extractBinaryText(fileBytes);
    } else if (["xlsx", "xls", "pptx"].includes(ext)) {
      text = extractBinaryText(fileBytes);
    } else {
      text = new TextDecoder().decode(fileBytes);
    }

    if (!text.trim()) {
      text = "(No readable text could be extracted from this document. The file may be image-based or encrypted.)";
    }

    return new Response(JSON.stringify({ text, fileName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("document-parse error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Parse failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function extractPdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const textParts: string[] = [];

  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textParts.push(decodePdfString(tjMatch[1]));
    }
    const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArrMatch[1];
      const strRegex = /\(([^)]*)\)/g;
      let strMatch;
      while ((strMatch = strRegex.exec(inner)) !== null) {
        textParts.push(decodePdfString(strMatch[1]));
      }
    }
  }

  if (textParts.length === 0) {
    const readable = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ");
    const words = readable.split(/\s+/).filter((w) => w.length > 2);
    if (words.length > 20) {
      return words.join(" ").substring(0, 50000);
    }
  }

  return textParts.join(" ").replace(/\s+/g, " ").trim().substring(0, 50000);
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .replace(/\\([()])/g, "$1");
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder("latin1").decode(bytes);
  const xmlParts: string[] = [];
  const xmlRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match;
  while ((match = xmlRegex.exec(raw)) !== null) {
    xmlParts.push(match[1]);
  }

  if (xmlParts.length > 0) {
    const pRegex = /<w:p[ >]/g;
    const parts = raw.split(pRegex);
    const result: string[] = [];
    for (const part of parts) {
      const words: string[] = [];
      const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      let m;
      while ((m = tRegex.exec(part)) !== null) {
        words.push(m[1]);
      }
      if (words.length > 0) result.push(words.join(""));
    }
    return result.join("\n").substring(0, 50000);
  }

  return extractBinaryText(bytes);
}

function extractBinaryText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const readable = raw.match(/[\x20-\x7E]{4,}/g) || [];
  const filtered = readable.filter((s) => /^[A-Za-z0-9\s.,;:!?'"()\-\/]+$/.test(s));
  return filtered.join(" ").substring(0, 50000);
}
