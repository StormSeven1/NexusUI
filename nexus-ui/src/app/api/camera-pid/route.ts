import { NextRequest, NextResponse } from "next/server";

import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";
import { parseCameraPid, type FetchEoPidResult } from "@/lib/eo-video/eoPidClient";

export const runtime = "nodejs";

/**
 * 浏览器 → camServer `GET /api/v1/pid?entityId=camera_NNN`
 * Query: `entityId` 必填；`backendBaseUrl` 可选（覆盖默认管理地址）
 */
export async function GET(req: NextRequest) {
  try {
    const entityId = (req.nextUrl.searchParams.get("entityId") ?? "").trim().toLowerCase();
    if (!/^camera_\d{3}$/.test(entityId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_entity_id", detail: "need entityId camera_NNN" } satisfies FetchEoPidResult,
        { status: 400 },
      );
    }

    const upstreamBase = (
      (req.nextUrl.searchParams.get("backendBaseUrl") ?? "").trim() || getCameraEntityBaseUrl()
    ).replace(/\/+$/, "");
    if (!upstreamBase) {
      return NextResponse.json(
        {
          ok: false,
          error: "service_not_configured",
          detail: "请配置 NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL",
        } satisfies FetchEoPidResult,
        { status: 503 },
      );
    }

    const url = `${upstreamBase}/api/v1/pid?entityId=${encodeURIComponent(entityId)}`;
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    let data: FetchEoPidResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as FetchEoPidResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }

    if (data.ok && data.pid) {
      const pid = parseCameraPid(data.pid);
      if (!pid) {
        return NextResponse.json(
          { ok: false, error: "invalid_pid_payload", detail: "upstream pid missing fields" },
          { status: 502 },
        );
      }
      data = { ...data, pid };
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies FetchEoPidResult,
      { status: 502 },
    );
  }
}
