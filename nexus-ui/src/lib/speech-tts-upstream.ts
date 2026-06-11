import {
  speechMode,
  speechTtsMode1UpstreamUrl,
  speechTtsMode2Defaults,
  speechTtsMode2UpstreamUrl,
} from "@/lib/speech-config";

export type SpeechTtsRequest = {
  text: string;
  language?: string;
  speaker?: string;
  instruct?: string;
};

const UPSTREAM_MS = 120000;
const HEALTH_PROBE_MS = 5000;

/** Mode 1：与 Qt `TTSClient::buildRequestUrl` 对齐的 query 参数 */
function buildMode1TtsUrl(text: string): string {
  const base = speechTtsMode1UpstreamUrl();
  const url = new URL(base);
  const textLang = process.env.NEXUS_SPEECH_TTS_TEXT_LANG?.trim() || "zh";
  const refAudioPath = process.env.NEXUS_SPEECH_TTS_REF_AUDIO_PATH?.trim() || "sound/xinghui.wav";
  const promptLang = process.env.NEXUS_SPEECH_TTS_PROMPT_LANG?.trim() || "zh";
  const promptText =
    process.env.NEXUS_SPEECH_TTS_PROMPT_TEXT?.trim() ||
    "老人家上了年纪，认错人了，这两位女士当时还是小孩子。";
  const textSplitMethod = process.env.NEXUS_SPEECH_TTS_TEXT_SPLIT_METHOD?.trim() || "cut5";
  const batchSize = process.env.NEXUS_SPEECH_TTS_BATCH_SIZE?.trim() || "1";
  const mediaType = process.env.NEXUS_SPEECH_TTS_MEDIA_TYPE?.trim() || "wav";
  const streamingMode = process.env.NEXUS_SPEECH_TTS_STREAMING_MODE?.trim() || "true";

  url.searchParams.set("text", text);
  url.searchParams.set("text_lang", textLang);
  url.searchParams.set("ref_audio_path", refAudioPath);
  url.searchParams.set("prompt_lang", promptLang);
  url.searchParams.set("prompt_text", promptText);
  url.searchParams.set("text_split_method", textSplitMethod);
  url.searchParams.set("batch_size", batchSize);
  url.searchParams.set("media_type", mediaType);
  url.searchParams.set("streaming_mode", streamingMode);
  return url.toString();
}

/** 请求上游 TTS，返回 WAV 二进制 */
export async function synthesizeSpeechUpstream(
  req: SpeechTtsRequest,
  timeoutMs = UPSTREAM_MS,
): Promise<{ audio?: ArrayBuffer; contentType?: string; error?: string }> {
  const text = req.text.trim();
  if (!text) return { error: "缺少有效 text" };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("upstream timeout")), timeoutMs);

  try {
    if (speechMode() === 2) {
      const defaults = speechTtsMode2Defaults();
      const form = new FormData();
      form.append("text", text);
      form.append("language", (req.language ?? defaults.language).trim());
      form.append("speaker", (req.speaker ?? defaults.speaker).trim());
      form.append("instruct", (req.instruct ?? defaults.instruct).trim());

      const upstream = await fetch(speechTtsMode2UpstreamUrl(), {
        method: "POST",
        body: form,
        signal: ac.signal,
        cache: "no-store",
      });
      if (!upstream.ok) {
        const detail = (await upstream.text().catch(() => "")).slice(0, 2000);
        return { error: detail || `TTS 上游错误 HTTP ${upstream.status}` };
      }
      const audio = await upstream.arrayBuffer();
      if (!audio.byteLength) return { error: "TTS 返回空音频" };
      return {
        audio,
        contentType: upstream.headers.get("content-type") || "audio/wav",
      };
    }

    const upstream = await fetch(buildMode1TtsUrl(text), {
      method: "GET",
      signal: ac.signal,
      cache: "no-store",
    });
    if (!upstream.ok) {
      const detail = (await upstream.text().catch(() => "")).slice(0, 2000);
      return { error: detail || `TTS 上游错误 HTTP ${upstream.status}` };
    }
    const audio = await upstream.arrayBuffer();
    if (!audio.byteLength) return { error: "TTS 返回空音频" };
    return {
      audio,
      contentType: upstream.headers.get("content-type") || "audio/wav",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.includes("timeout") || msg.includes("aborted") ? "TTS 服务超时" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 探测 TTS 上游是否就绪 */
export async function probeSpeechTtsUpstream(
  timeoutMs = HEALTH_PROBE_MS,
): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
  try {
    if (speechMode() === 2) {
      const res = await fetch(speechTtsMode2UpstreamUrl(), {
        method: "POST",
        signal: ac.signal,
        cache: "no-store",
      });
      if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
        return { ok: false, status: res.status };
      }
      if (res.ok || res.status === 400 || res.status === 405 || res.status === 415 || res.status === 422) {
        return { ok: true, status: res.status };
      }
      return { ok: false, status: res.status };
    }

    const res = await fetch(speechTtsMode1UpstreamUrl(), {
      method: "GET",
      signal: ac.signal,
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
      return { ok: false, status: res.status };
    }
    if (res.ok || res.status === 400 || res.status === 405 || res.status === 422) {
      return { ok: true, status: res.status };
    }
    return { ok: false, status: res.status };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, detail };
  } finally {
    clearTimeout(timer);
  }
}
