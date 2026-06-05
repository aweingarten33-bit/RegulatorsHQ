import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VOICE_A = "EXAVITQu4vr4xnSDxMaL";
const VOICE_B = "TX3LPaxmHKxFdv7VOQHJ";

async function generateTTS(text: string, voiceId: string, apiKey: string): Promise<ArrayBuffer> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 5000),
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.5, use_speaker_boost: true, speed: 0.95 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("ElevenLabs error:", response.status, err);
    if (response.status === 401 || response.status === 403) {
      try {
        const parsed = JSON.parse(err);
        if (parsed?.detail?.status === "quota_exceeded") {
          throw new Error("ElevenLabs credits exhausted. Please top up your plan at elevenlabs.io.");
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message.includes("credits exhausted")) throw parseErr;
      }
    }
    throw new Error(`TTS failed: ${response.status}`);
  }

  return response.arrayBuffer();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { user, error: authError } = await requireAuth(req);
  if (authError || !user) return unauthorizedResponse(corsHeaders);

  try {
    const body = await req.json();
    const { text, voiceId, dialogue } = body;

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) {
      return new Response(JSON.stringify({ error: "ElevenLabs API key not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (dialogue && Array.isArray(dialogue) && dialogue.length > 0) {
      const audioChunks: ArrayBuffer[] = [];
      const turnTimings: { speaker: string; startByte: number; endByte: number }[] = [];
      let byteOffset = 0;

      for (let i = 0; i < dialogue.length; i++) {
        const turn = dialogue[i];
        const voice = turn.speaker === "A" ? VOICE_A : VOICE_B;
        try {
          const buffer = await generateTTS(turn.text, voice, ELEVENLABS_API_KEY);
          turnTimings.push({ speaker: turn.speaker, startByte: byteOffset, endByte: byteOffset + buffer.byteLength });
          byteOffset += buffer.byteLength;
          audioChunks.push(buffer);
        } catch (e) {
          console.error(`Failed on turn ${i}:`, e);
          if (i === 0) break;
          if (e instanceof Error && (e.message.includes("401") || e.message.includes("credits"))) break;
        }
        if (i < dialogue.length - 1) await new Promise((r) => setTimeout(r, 200));
      }

      if (audioChunks.length === 0) {
        return new Response(JSON.stringify({ error: "Voice generation unavailable — ElevenLabs credits may be exhausted. Falling back to transcript.", fallback: "transcript" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const totalLength = audioChunks.reduce((sum, buf) => sum + buf.byteLength, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of audioChunks) { combined.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }

      return new Response(combined.buffer, {
        headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "X-Turn-Count": String(turnTimings.length), "X-Dialogue-Mode": "true" },
      });
    }

    if (!text) return new Response(JSON.stringify({ error: "Missing text" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const selectedVoice = voiceId || VOICE_A;
    const audioBuffer = await generateTTS(text, selectedVoice, ELEVENLABS_API_KEY);
    return new Response(audioBuffer, { headers: { ...corsHeaders, "Content-Type": "audio/mpeg" } });
  } catch (error) {
    console.error("elevenlabs-tts error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
