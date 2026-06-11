/**
 * 智能语音模式：
 * - 1：Qt 同源 `POST /asr`（multipart file）+ `GET /tts`（query 参数）
 * - 2：`POST /v1/chat/completions`（audio base64 Data URL）+ `POST /v1/tts`（multipart）
 */
export type SpeechMode = 1 | 2;

export function speechMode(): SpeechMode {
  const raw = process.env.NEXUS_SPEECH_MODE?.trim();
  return raw === "2" ? 2 : 1;
}

function joinUrl(host: string, port: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const portPart = port && port !== "80" ? `:${port}` : "";
  return `http://${host}${portPart}${normalizedPath}`;
}

/** Mode 1 ASR：`POST multipart file` */
export function speechAsrMode1UpstreamUrl(): string {
  const full = process.env.NEXUS_SPEECH_ASR_URL?.trim();
  if (full) return full.replace(/\/$/, "");

  const host =
    process.env.NEXUS_SPEECH_ASR_HOST?.trim() ||
    process.env.NEXUS_ALI_AUDIO_TRANS_HOST?.trim() ||
    process.env.NEXUS_TASK_SERVER_HOST?.trim() ||
    "192.168.18.141";
  const portRaw =
    process.env.NEXUS_SPEECH_ASR_PORT?.trim() ||
    process.env.NEXUS_ALI_AUDIO_TRANS_PORT?.trim() ||
    "";
  const path = process.env.NEXUS_SPEECH_ASR_PATH?.trim() || "/asr";
  return joinUrl(host, portRaw && portRaw !== "80" ? portRaw : "", path);
}

/** Mode 2 ASR：`POST /v1/chat/completions`，body 内 audio_url Data URL */
export function speechAsrMode2UpstreamUrl(): string {
  const full = process.env.NEXUS_SPEECH_ASR_V2_URL?.trim();
  if (full) return full.replace(/\/$/, "");

  const host = process.env.NEXUS_SPEECH_ASR_V2_HOST?.trim() || "192.168.18.141";
  const port = process.env.NEXUS_SPEECH_ASR_V2_PORT?.trim() || "8001";
  const path = process.env.NEXUS_SPEECH_ASR_V2_PATH?.trim() || "/v1/chat/completions";
  return joinUrl(host, port, path);
}

/** Mode 1 TTS：Qt `TTSClient::buildRequestUrl` → `GET /tts?text=...` */
export function speechTtsMode1UpstreamUrl(): string {
  const full = process.env.NEXUS_SPEECH_TTS_URL?.trim();
  if (full) return full.replace(/\/$/, "");

  const host =
    process.env.NEXUS_SPEECH_TTS_HOST?.trim() ||
    process.env.NEXUS_TASK_SERVER_HOST?.trim() ||
    "192.168.18.141";
  const port = process.env.NEXUS_SPEECH_TTS_PORT?.trim() || "9880";
  const path = process.env.NEXUS_SPEECH_TTS_PATH?.trim() || "/tts";
  return joinUrl(host, port, path);
}

/** Mode 2 TTS：`POST /v1/tts` multipart */
export function speechTtsMode2UpstreamUrl(): string {
  const full = process.env.NEXUS_SPEECH_TTS_V2_URL?.trim();
  if (full) return full.replace(/\/$/, "");

  const host = process.env.NEXUS_SPEECH_TTS_V2_HOST?.trim() || "192.168.18.141";
  const port = process.env.NEXUS_SPEECH_TTS_V2_PORT?.trim() || "8002";
  const path = process.env.NEXUS_SPEECH_TTS_V2_PATH?.trim() || "/v1/tts";
  return joinUrl(host, port, path);
}

export function speechTtsMode2Defaults(): {
  language: string;
  speaker: string;
  instruct: string;
} {
  return {
    language: process.env.NEXUS_SPEECH_TTS_V2_LANGUAGE?.trim() || "Chinese",
    speaker: process.env.NEXUS_SPEECH_TTS_V2_SPEAKER?.trim() || "Vivian",
    instruct: process.env.NEXUS_SPEECH_TTS_V2_INSTRUCT?.trim() || "用特别威严的语气说",
  };
}

/** 当前模式下的 ASR / TTS 上游地址（供 health 与日志） */
export function speechAsrUpstreamUrl(): string {
  return speechMode() === 2 ? speechAsrMode2UpstreamUrl() : speechAsrMode1UpstreamUrl();
}

export function speechTtsUpstreamUrl(): string {
  return speechMode() === 2 ? speechTtsMode2UpstreamUrl() : speechTtsMode1UpstreamUrl();
}
