import { NextRequest, NextResponse } from "next/server";
import { parseSpeechAsrResponse, speechAsrUpstreamUrl } from "@/lib/speech-asr-upstream";

export const runtime = "nodejs";

const UPSTREAM_MS = 60000;

/**
 * 浏览器录音 → Next BFF → Qt `HttpManage::PostSendData()` LLMMode==2 同源 `POST /asr`。
 * 与 `GPTInterfaceWgt::sendAudioFile` 一致：multipart 字段名 `file`。
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "缺少有效音频 file" }, { status: 400 });
  }

  const upstreamUrl = speechAsrUpstreamUrl();
  const out = new FormData();
  const name =
    typeof (file as Blob & { name?: string }).name === "string" && (file as Blob & { name?: string }).name
      ? (file as Blob & { name?: string }).name!
      : "audio.webm";
  // Qt 侧 Content-Type 写 audio/mpeg、filename audio.mp3；服务端通常按内容识别
  const nodeFile = new File([await file.arrayBuffer()], name, {
    type: file.type || "audio/webm",
  });
  out.append("file", nodeFile);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("upstream timeout")), UPSTREAM_MS);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      body: out,
      signal: ac.signal,
      cache: "no-store",
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "语音识别服务不可达", detail: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  const raw = await upstream.text().catch(() => "");
  if (!upstream.ok) {
    return NextResponse.json(
      { error: "语音识别上游错误", detail: raw.slice(0, 2000) },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  const parsed = parseSpeechAsrResponse(raw);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 502 });
  }

  return NextResponse.json({ text: parsed.text ?? "" });
}
