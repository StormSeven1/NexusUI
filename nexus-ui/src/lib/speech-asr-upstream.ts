import {
  speechAsrMode1UpstreamUrl,
  speechAsrMode2UpstreamUrl,
  speechAsrUpstreamUrl,
  speechMode,
} from "@/lib/speech-config";
import { convertSpeechToWav16k, isWavSpeechInput } from "@/lib/speech-audio-wav.server";

export { speechAsrUpstreamUrl, speechMode };

const UPSTREAM_MS = 300000;
const HEALTH_PROBE_MS = 5000;

/** 解析 Mode 1 上游返回：LLMMode==2 的 `{ res }`、Whisper 的 `{ text }` 或纯文本 */
export function parseSpeechAsrMode1Response(raw: string): { text?: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "语音识别返回空内容" };

  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as {
        res?: unknown;
        text?: unknown;
        error?: unknown;
        message?: unknown;
      };
      const err =
        (typeof j.error === "string" ? j.error.trim() : "") ||
        (typeof j.message === "string" ? j.message.trim() : "");
      if (err) return { error: err };
      const fromRes = typeof j.res === "string" ? j.res.trim() : "";
      if (fromRes) return { text: fromRes };
      const fromText = typeof j.text === "string" ? j.text.trim() : "";
      if (fromText) return { text: fromText };
      return { error: "语音识别返回无 res/text 字段" };
    } catch {
      /* 非 JSON，按纯文本处理 */
    }
  }

  return { text: trimmed };
}

/** 解析 Qwen3-ASR：`language Chinese<asr_text>文本<asr_text>` */
function extractQwenAsrText(content: string): string {
  const marker = "<asr_text>";
  const idx = content.indexOf(marker);
  if (idx < 0) return content.trim();
  const after = content.slice(idx + marker.length);
  const end = after.indexOf(marker);
  return (end >= 0 ? after.slice(0, end) : after).trim();
}

/** 解析 Mode 2 chat/completions 返回 */
export function parseSpeechAsrMode2Response(raw: string): { text?: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "语音识别返回空内容" };

  try {
    const j = JSON.parse(trimmed) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: unknown;
      message?: unknown;
    };
    const nestedErr = j.error;
    if (nestedErr && typeof nestedErr === "object" && nestedErr !== null) {
      const msg = (nestedErr as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) return { error: msg.trim() };
    }
    const err =
      (typeof j.error === "string" ? j.error.trim() : "") ||
      (typeof j.message === "string" ? j.message.trim() : "");
    if (err) return { error: err };

    const content = j.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      const text = extractQwenAsrText(content.trim());
      if (text) return { text };
      return { error: "识别结果为空" };
    }
    return { error: "语音识别返回无 choices[0].message.content" };
  } catch {
    return parseSpeechAsrMode1Response(raw);
  }
}

export function parseSpeechAsrResponse(raw: string): { text?: string; error?: string } {
  return speechMode() === 2 ? parseSpeechAsrMode2Response(raw) : parseSpeechAsrMode1Response(raw);
}

function audioMimeForDataUrl(mimeType: string, fileName: string): string {
  // Qwen3-ASR 等上游只认 `data:audio/webm;base64,...`；带 `;codecs=opus` 会误判为非 base64 URL
  const mt = mimeType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  if (mt) return mt;
  if (fileName.endsWith(".wav")) return "audio/wav";
  if (fileName.endsWith(".webm")) return "audio/webm";
  if (fileName.endsWith(".mp3") || fileName.endsWith(".mpeg")) return "audio/mpeg";
  return "audio/webm";
}

function upstreamErrorText(raw: string, status: number): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as {
        error?: { message?: unknown } | string;
        message?: unknown;
      };
      if (j.error && typeof j.error === "object" && typeof j.error.message === "string") {
        const msg = j.error.message.trim();
        if (msg) return msg;
      }
      if (typeof j.error === "string" && j.error.trim()) return j.error.trim();
      if (typeof j.message === "string" && j.message.trim()) return j.message.trim();
    } catch {
      /* 非 JSON */
    }
  }
  return trimmed.slice(0, 2000) || `语音识别上游错误 HTTP ${status}`;
}

/** Mode 1：multipart file → `/asr` */
async function transcribeMode1(
  file: Blob,
  fileName: string,
  mimeType: string,
  timeoutMs: number,
): Promise<{ text?: string; error?: string }> {
  const out = new FormData();
  const nodeFile = new File([await file.arrayBuffer()], fileName, {
    type: mimeType || file.type || "audio/webm",
  });
  out.append("file", nodeFile);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("upstream timeout")), timeoutMs);
  try {
    const upstream = await fetch(speechAsrMode1UpstreamUrl(), {
      method: "POST",
      body: out,
      signal: ac.signal,
      cache: "no-store",
    });
    const raw = await upstream.text().catch(() => "");
    if (!upstream.ok) {
      return { error: upstreamErrorText(raw, upstream.status) };
    }
    return parseSpeechAsrMode1Response(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.includes("timeout") || msg.includes("aborted") ? "语音识别服务超时" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Mode 2：audio Data URL → `/v1/chat/completions`（非 wav 先 ffmpeg 转 16kHz mono wav） */
async function transcribeMode2(
  file: Blob,
  fileName: string,
  mimeType: string,
  timeoutMs: number,
): Promise<{ text?: string; error?: string }> {
  const resolvedMime = mimeType || file.type || "audio/webm";
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let mime = audioMimeForDataUrl(resolvedMime, fileName);

  if (!isWavSpeechInput(resolvedMime, fileName)) {
    const converted = await convertSpeechToWav16k(buffer, resolvedMime, fileName);
    if (converted.error) return { error: converted.error };
    buffer = converted.wav;
    mime = "audio/wav";
  }

  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("upstream timeout")), timeoutMs);
  try {
    const upstream = await fetch(speechAsrMode2UpstreamUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ type: "audio_url", audio_url: { url: dataUrl } }],
          },
        ],
      }),
      signal: ac.signal,
      cache: "no-store",
    });
    const raw = await upstream.text().catch(() => "");
    if (!upstream.ok) {
      return { error: upstreamErrorText(raw, upstream.status) };
    }
    return parseSpeechAsrMode2Response(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.includes("timeout") || msg.includes("aborted") ? "语音识别服务超时" : msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 统一 ASR 入口（按 NEXUS_SPEECH_MODE 切换） */
export async function transcribeSpeechUpstream(
  file: Blob,
  opts?: { fileName?: string; mimeType?: string; timeoutMs?: number },
): Promise<{ text?: string; error?: string }> {
  const fileName = opts?.fileName?.trim() || "audio.webm";
  const mimeType = opts?.mimeType?.trim() || file.type || "audio/webm";
  const timeoutMs = opts?.timeoutMs ?? UPSTREAM_MS;
  return speechMode() === 2
    ? transcribeMode2(file, fileName, mimeType, timeoutMs)
    : transcribeMode1(file, fileName, mimeType, timeoutMs);
}

/**
 * 探测 ASR 上游是否就绪。
 * Mode 1：POST 无 file 时若返回 400/422/405 等，说明路由存在。
 * Mode 2：POST 空 JSON 时同理。
 */
export async function probeSpeechAsrUpstream(
  timeoutMs = HEALTH_PROBE_MS,
): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
  try {
    const url = speechAsrUpstreamUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: speechMode() === 2 ? { "Content-Type": "application/json" } : undefined,
      body: speechMode() === 2 ? JSON.stringify({ messages: [] }) : undefined,
      signal: ac.signal,
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
      return { ok: false, status: res.status };
    }
    if (
      res.ok ||
      res.status === 400 ||
      res.status === 405 ||
      res.status === 415 ||
      res.status === 422
    ) {
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
