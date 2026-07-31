import { NextRequest, NextResponse } from "next/server";

import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";
import type { EoBurnInSelectResult } from "@/lib/eo-video/eoBurnInSelectClient";

export const runtime = "nodejs";

/**
 * 浏览器 → camServer `POST /api/v1/burn-in/select`
 * Body: `{ entityId, cameraIndex?, rectId, backendBaseUrl? }`
 */
export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const entityId = String(raw.entityId ?? "")
      .trim()
      .toLowerCase();
    if (!entityId) {
      return NextResponse.json(
        { ok: false, error: "invalid_entity_id", detail: "need entityId" } satisfies EoBurnInSelectResult,
        { status: 400 },
      );
    }

    const rectRaw = raw.rectId;
    const rectId =
      rectRaw == null || rectRaw === ""
        ? 0
        : Number.isFinite(Number(rectRaw))
          ? Math.trunc(Number(rectRaw))
          : 0;

    const upstreamBase = (
      String(raw.backendBaseUrl ?? "").trim() || getCameraEntityBaseUrl()
    ).replace(/\/+$/, "");
    if (!upstreamBase) {
      return NextResponse.json(
        {
          ok: false,
          error: "service_not_configured",
          detail: "请配置 NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL",
        } satisfies EoBurnInSelectResult,
        { status: 503 },
      );
    }

    const body: Record<string, unknown> = { entityId, rectId };
    if (raw.cameraIndex != null && Number.isFinite(Number(raw.cameraIndex)))
      body.cameraIndex = Math.trunc(Number(raw.cameraIndex));

    const url = `${upstreamBase}/api/v1/burn-in/select`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const text = await upstream.text();
    let data: EoBurnInSelectResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as EoBurnInSelectResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies EoBurnInSelectResult,
      { status: 502 },
    );
  }
}
