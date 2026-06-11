import { NextResponse } from "next/server";
import { speechMode, speechTtsUpstreamUrl } from "@/lib/speech-config";
import { probeSpeechTtsUpstream } from "@/lib/speech-tts-upstream";

export const runtime = "nodejs";

/** 文字转语音前探测 TTS 上游是否可达 */
export async function GET() {
  const upstream = speechTtsUpstreamUrl();
  const probe = await probeSpeechTtsUpstream();
  return NextResponse.json(
    {
      ok: probe.ok,
      mode: speechMode(),
      upstream,
      status: probe.status ?? null,
      detail: probe.detail ?? null,
    },
    { status: probe.ok ? 200 : 503 },
  );
}
