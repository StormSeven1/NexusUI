import { NextResponse } from "next/server";

import {
  normalizeWeatherDisplay,
  resolveWeatherUpstreamUrl,
  type WeatherApiPayload,
} from "@/lib/weather-api.server";

export const runtime = "nodejs";

/** 代理 TaskServer 气象接口，供顶栏展示（避免浏览器跨域） */
export async function GET() {
  const upstreamUrl = resolveWeatherUpstreamUrl();

  try {
    const res = await fetch(upstreamUrl, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
    });
    const text = await res.text();
    let payload: WeatherApiPayload;
    try {
      payload = JSON.parse(text) as WeatherApiPayload;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "上游返回非 JSON",
          upstreamUrl,
          snippet: text.slice(0, 200),
        },
        { status: 502 },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `上游 HTTP ${res.status}`,
          upstreamUrl,
          snippet: text.slice(0, 400),
        },
        { status: 502 },
      );
    }

    if (payload.code !== 0) {
      return NextResponse.json(
        {
          ok: false,
          error: payload.message ?? "weather response code is not 0",
          upstreamUrl,
          code: payload.code,
        },
        { status: 502 },
      );
    }

    const display = normalizeWeatherDisplay(payload.data);
    return NextResponse.json(
      {
        ok: true,
        upstreamUrl,
        fetchedAt: new Date().toISOString(),
        ...display,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg, upstreamUrl },
      { status: 500 },
    );
  }
}
