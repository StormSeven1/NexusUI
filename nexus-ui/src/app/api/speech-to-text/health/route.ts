import { NextResponse } from "next/server";
import { probeSpeechAsrUpstream, speechAsrUpstreamUrl } from "@/lib/speech-asr-upstream";

export const runtime = "nodejs";

/** 智能助手录音前探测 ASR 上游 `/asr` 是否可达 */
export async function GET() {
  const upstream = speechAsrUpstreamUrl();
  const probe = await probeSpeechAsrUpstream();
  return NextResponse.json(
    {
      ok: probe.ok,
      upstream,
      status: probe.status ?? null,
      detail: probe.detail ?? null,
    },
    { status: probe.ok ? 200 : 503 },
  );
}
