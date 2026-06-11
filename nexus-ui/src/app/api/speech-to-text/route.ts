import { NextRequest, NextResponse } from "next/server";
import { speechMode } from "@/lib/speech-config";
import { transcribeSpeechUpstream } from "@/lib/speech-asr-upstream";

export const runtime = "nodejs";

/**
 * 浏览器录音 → Next BFF → 上游 ASR。
 * - Mode 1：Qt `HttpManage::PostSendData()` LLMMode==2 同源 `POST /asr`（multipart `file`）
 * - Mode 2：`POST /v1/chat/completions`（audio Data URL base64）
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

  const name =
    typeof (file as Blob & { name?: string }).name === "string" && (file as Blob & { name?: string }).name
      ? (file as Blob & { name?: string }).name!
      : "audio.webm";

  const parsed = await transcribeSpeechUpstream(file, {
    fileName: name,
    mimeType: file.type || "audio/webm",
  });

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error, mode: speechMode() }, { status: 502 });
  }

  return NextResponse.json({ text: parsed.text ?? "", mode: speechMode() });
}
