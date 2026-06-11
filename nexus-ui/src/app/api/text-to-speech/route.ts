import { NextRequest, NextResponse } from "next/server";
import { speechMode } from "@/lib/speech-config";
import { synthesizeSpeechUpstream } from "@/lib/speech-tts-upstream";

export const runtime = "nodejs";

/**
 * 文字 → 语音 WAV。
 * - Mode 1：Qt `TTSClient` 同源 `GET /tts?text=...`
 * - Mode 2：`POST /v1/tts` multipart（text / language / speaker / instruct）
 */
export async function POST(req: NextRequest) {
  let body: { text?: string; language?: string; speaker?: string; instruct?: string };
  try {
    body = (await req.json()) as { text?: string; language?: string; speaker?: string; instruct?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "缺少有效 text" }, { status: 400 });
  }

  const result = await synthesizeSpeechUpstream({
    text,
    language: body.language,
    speaker: body.speaker,
    instruct: body.instruct,
  });

  if (result.error || !result.audio) {
    return NextResponse.json({ error: result.error || "TTS 失败", mode: speechMode() }, { status: 502 });
  }

  return new NextResponse(result.audio, {
    status: 200,
    headers: {
      "Content-Type": result.contentType || "audio/wav",
      "Cache-Control": "no-store",
      "X-Speech-Mode": String(speechMode()),
    },
  });
}
