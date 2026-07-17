import { NextResponse } from "next/server";

import { collectWeatherBundle } from "@/lib/weather-api.server";

export const runtime = "nodejs";

/** 顶栏气象：气温/风速以 Vaisala 为主；降雨回退；附带三路详细摘要 */
export async function GET() {
  try {
    const bundle = await collectWeatherBundle();
    if (!bundle.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: bundle.error ?? "weather unavailable",
          upstreamUrl: bundle.upstreamUrl,
          rainfallSource: bundle.rainfallSource,
          sources: bundle.sources,
          fetchedAt: bundle.fetchedAt,
          weather: bundle.weather,
          temperature: bundle.temperature,
          windSpeed: bundle.windSpeed,
          rainfall: bundle.rainfall,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        upstreamUrl: bundle.upstreamUrl,
        rainfallSource: bundle.rainfallSource,
        airportTopic: bundle.airportTopic,
        sources: bundle.sources,
        fetchedAt: bundle.fetchedAt,
        weather: bundle.weather,
        temperature: bundle.temperature,
        windSpeed: bundle.windSpeed,
        rainfall: bundle.rainfall,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
