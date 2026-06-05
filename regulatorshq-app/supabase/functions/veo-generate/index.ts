import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Poll an operation until done or timeout
async function pollOperation(opName: string, apiKey: string, maxAttempts = 60): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`${BASE_URL}/${opName}`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`Poll error ${res.status}:`, t);
      continue;
    }
    const data = await res.json();
    if (data.done) return data;
  }
  throw new Error("Operation timed out");
}

// Download a generated video file as base64
async function downloadVideo(fileUri: string, apiKey: string): Promise<string | null> {
  try {
    const fileName = fileUri.replace("https://generativelanguage.googleapis.com/v1beta/", "");
    const res = await fetch(`${BASE_URL}/${fileName}?alt=media`, {
      headers: { "x-goog-api-key": apiKey },
    });
    if (!res.ok) {
      console.error("Download failed:", res.status, await res.text());
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Convert to base64 in chunks to avoid stack overflow
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:video/mp4;base64,${btoa(binary)}`;
  } catch (e) {
    console.error("Download failed:", e);
    return null;
  }
}

// Extract video URI from operation response
function extractVideoUri(opResult: any): string | null {
  const samples = opResult?.response?.generateVideoResponse?.generatedSamples;
  if (samples?.length > 0 && samples[0]?.video?.uri) {
    return samples[0].video.uri;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) {
      return new Response(JSON.stringify({ error: "Google AI API key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { prompt, targetDuration } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const target = targetDuration || 30;
    // Use veo-3.1 for both generation and extension
    const MODEL = "veo-3.1-generate-preview";

    console.log(`Starting Veo generation: "${prompt.slice(0, 80)}…" target=${target}s`);

    // ── Step 1: Generate initial 8-second clip ──
    const genRes = await fetch(
      `${BASE_URL}/models/${MODEL}:predictLongRunning`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GOOGLE_AI_API_KEY,
        },
        body: JSON.stringify({
          instances: [{ prompt: prompt.slice(0, 2000) }],
          parameters: {
            aspectRatio: "16:9",
            durationSeconds: 8,
          },
        }),
      }
    );

    if (!genRes.ok) {
      const err = await genRes.text();
      console.error("Veo initial generation error:", genRes.status, err);
      return new Response(JSON.stringify({ error: `Veo generation failed: ${genRes.status}`, details: err }), {
        status: genRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const genData = await genRes.json();
    if (!genData.name) {
      return new Response(JSON.stringify({ error: "No operation name returned", data: genData }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Poll for initial clip
    console.log("Polling for initial 8s clip…");
    const initialResult = await pollOperation(genData.name, GOOGLE_AI_API_KEY);
    const initialUri = extractVideoUri(initialResult);
    if (!initialUri) {
      console.error("No video URI in result:", JSON.stringify(initialResult).slice(0, 500));
      return new Response(JSON.stringify({ error: "No video generated" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let currentDuration = 8;
    let currentVideoUri = initialUri;

    // ── Step 2: Extend video in 7-second increments until target ──
    if (target > 8) {
      const extensionsNeeded = Math.ceil((target - 8) / 7);
      console.log(`Need ${extensionsNeeded} extensions to reach ~${target}s`);

      for (let ext = 0; ext < extensionsNeeded; ext++) {
        console.log(`Extension ${ext + 1}/${extensionsNeeded} (current: ${currentDuration}s)…`);

        const extRes = await fetch(
          `${BASE_URL}/models/${MODEL}:predictLongRunning`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": GOOGLE_AI_API_KEY,
            },
            body: JSON.stringify({
              instances: [{
                prompt: prompt.slice(0, 2000),
                video: { uri: currentVideoUri },
              }],
              parameters: {
                aspectRatio: "16:9",
              },
            }),
          }
        );

        if (!extRes.ok) {
          const err = await extRes.text();
          console.error(`Extension ${ext + 1} failed:`, extRes.status, err);
          break;
        }

        const extData = await extRes.json();
        if (!extData.name) {
          console.error(`Extension ${ext + 1}: no operation name`);
          break;
        }

        const extResult = await pollOperation(extData.name, GOOGLE_AI_API_KEY);
        const extUri = extractVideoUri(extResult);
        if (!extUri) {
          console.error(`Extension ${ext + 1}: no video URI in result`);
          break;
        }

        currentVideoUri = extUri;
        currentDuration += 7;
        console.log(`Extended to ~${currentDuration}s`);
      }
    }

    // ── Step 3: Download final video ──
    console.log(`Downloading final video (~${currentDuration}s)…`);
    const videoData = await downloadVideo(currentVideoUri, GOOGLE_AI_API_KEY);

    if (!videoData) {
      return new Response(JSON.stringify({ error: "Failed to download final video" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      video: videoData,
      durationSeconds: currentDuration,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("veo-generate error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
