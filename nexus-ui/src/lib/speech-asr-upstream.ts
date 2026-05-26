/**
 * 与 Qt `HttpManage::PostSendData()`（LLMMode==2）对齐：
 * `ALI_AUDIO_TRANS_FMT` → `POST http://{AliAudioTransIP}/asr`（无端口时用 80）
 * multipart 字段 `file`；响应 JSON `{ "res": "识别文字" }`。
 */
export function speechAsrUpstreamUrl(): string {
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
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const port = portRaw && portRaw !== "80" ? portRaw : "";
  return port
    ? `http://${host}:${port}${normalizedPath}`
    : `http://${host}${normalizedPath}`;
}

/** 解析上游返回：LLMMode==2 的 `{ res }`、Whisper 的 `{ text }` 或纯文本 */
export function parseSpeechAsrResponse(raw: string): { text?: string; error?: string } {
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

const HEALTH_PROBE_MS = 5000;

/**
 * 探测 ASR 上游是否就绪。
 * POST 无 file 时若返回 400/422/405 等，说明路由存在；404/超时视为不可用。
 */
export async function probeSpeechAsrUpstream(
  timeoutMs = HEALTH_PROBE_MS,
): Promise<{ ok: boolean; status?: number; detail?: string }> {
  const url = speechAsrUpstreamUrl();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
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
