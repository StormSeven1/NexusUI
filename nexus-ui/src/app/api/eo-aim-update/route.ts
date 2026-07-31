import { NextRequest, NextResponse } from "next/server";

import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";

export const runtime = "nodejs";

function parseCameraIndex(entityId: string): number | null {
  const m = entityId.trim().match(/^camera_(\d+)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 浏览器 → camServer `POST /api/v1/aim-update`
 * Body: `{ entityId: "camera_004", aimType?: 0|1, backendBaseUrl?: string }`
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      entityId?: string;
      cameraIndex?: number;
      aimType?: number;
      backendBaseUrl?: string;
    };
    const entityId = String(body.entityId ?? "").trim();
    let cameraIndex =
      body.cameraIndex != null && Number.isFinite(Number(body.cameraIndex))
        ? Math.trunc(Number(body.cameraIndex))
        : null;
    if (cameraIndex == null || cameraIndex < 0) {
      cameraIndex = entityId ? parseCameraIndex(entityId) : null;
    }
    if (cameraIndex == null || cameraIndex < 0) {
      return NextResponse.json(
        { ok: false, error: "invalid_request", detail: "need cameraIndex or entityId camera_NNN" },
        { status: 400 },
      );
    }

    const upstreamBase = (
      String(body.backendBaseUrl ?? "").trim() || getCameraEntityBaseUrl()
    ).replace(/\/+$/, "");
    if (!upstreamBase) {
      return NextResponse.json(
        {
          ok: false,
          error: "service_not_configured",
          detail: "请配置 NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL",
        },
        { status: 503 },
      );
    }

    const payload: Record<string, unknown> = { cameraIndex };
    if (body.aimType === 0 || body.aimType === 1) {
      payload.aimType = body.aimType;
    }
    if (entityId) payload.entityId = entityId;

    const upstream = await fetch(`${upstreamBase}/api/v1/aim-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      // 对海/对空各最多 180s；默认两者串行，BFF 放宽到 400s
      signal: AbortSignal.timeout(400_000),
    });
    const text = await upstream.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }
    return NextResponse.json(data ?? { ok: false, error: "empty_upstream" }, {
      status: upstream.status,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "aim_update_proxy_failed", detail }, { status: 502 });
  }
}
