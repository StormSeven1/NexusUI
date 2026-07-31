import { NextRequest, NextResponse } from "next/server";

import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";
import type { EoBurnInPlacardResult } from "@/lib/eo-video/eoBurnInPlacardClient";

export const runtime = "nodejs";

/**
 * 浏览器 → camServer `POST /api/v1/burn-in/placard`
 * Body: `{ entityId, cameraIndex?, trackId?, isAir?, clear?, backendBaseUrl? }`
 * 仅航迹 ID 标题条；无有效 trackId 时上游会 clear。
 */
export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const entityId = String(raw.entityId ?? "")
      .trim()
      .toLowerCase();
    if (!entityId) {
      return NextResponse.json(
        { ok: false, error: "invalid_entity_id", detail: "need entityId" } satisfies EoBurnInPlacardResult,
        { status: 400 },
      );
    }

    const upstreamBase = (
      String(raw.backendBaseUrl ?? "").trim() || getCameraEntityBaseUrl()
    ).replace(/\/+$/, "");
    if (!upstreamBase) {
      return NextResponse.json(
        {
          ok: false,
          error: "service_not_configured",
          detail: "请配置 NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL",
        } satisfies EoBurnInPlacardResult,
        { status: 503 },
      );
    }

    const body: Record<string, unknown> = {
      entityId,
      clear: raw.clear === true,
    };
    if (raw.cameraIndex != null && Number.isFinite(Number(raw.cameraIndex)))
      body.cameraIndex = Math.trunc(Number(raw.cameraIndex));
    if (raw.trackId != null && Number.isFinite(Number(raw.trackId)))
      body.trackId = Math.trunc(Number(raw.trackId));
    if (raw.isAir != null) body.isAir = Boolean(raw.isAir);

    const url = `${upstreamBase}/api/v1/burn-in/placard`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const text = await upstream.text();
    let data: EoBurnInPlacardResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as EoBurnInPlacardResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies EoBurnInPlacardResult,
      { status: 502 },
    );
  }
}
