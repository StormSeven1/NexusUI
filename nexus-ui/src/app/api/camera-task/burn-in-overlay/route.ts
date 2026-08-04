import { NextRequest, NextResponse } from "next/server";

import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";
import type { EoBurnInOverlayResult } from "@/lib/eo-video/eoBurnInOverlayClient";

export const runtime = "nodejs";

function upstreamBaseFrom(raw: Record<string, unknown> | URLSearchParams): string {
  const fromBody =
    raw instanceof URLSearchParams
      ? (raw.get("backendBaseUrl") ?? "").trim()
      : String(raw.backendBaseUrl ?? "").trim();
  return (fromBody || getCameraEntityBaseUrl()).replace(/\/+$/, "");
}

/**
 * 浏览器 → camServer `GET|POST /api/v1/burn-in/overlay`
 * Body/Query: `{ entityId, cameraIndex?, hideOverlay?, backendBaseUrl? }`
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const entityId = (sp.get("entityId") ?? "").trim().toLowerCase();
    if (!entityId) {
      return NextResponse.json(
        { ok: false, error: "invalid_entity_id", detail: "need entityId" } satisfies EoBurnInOverlayResult,
        { status: 400 },
      );
    }
    const upstreamBase = upstreamBaseFrom(sp);
    if (!upstreamBase) {
      return NextResponse.json(
        {
          ok: false,
          error: "service_not_configured",
          detail: "请配置 NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL",
        } satisfies EoBurnInOverlayResult,
        { status: 503 },
      );
    }
    const q = new URLSearchParams({ entityId });
    const ci = sp.get("cameraIndex");
    if (ci) q.set("cameraIndex", ci);
    const url = `${upstreamBase}/api/v1/burn-in/overlay?${q.toString()}`;
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const text = await upstream.text();
    let data: EoBurnInOverlayResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as EoBurnInOverlayResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies EoBurnInOverlayResult,
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    const entityId = String(raw.entityId ?? "")
      .trim()
      .toLowerCase();
    if (!entityId) {
      return NextResponse.json(
        { ok: false, error: "invalid_entity_id", detail: "need entityId" } satisfies EoBurnInOverlayResult,
        { status: 400 },
      );
    }

    const hideOverlay = !!(
      raw.hideOverlay === true ||
      raw.checked === true ||
      raw.drawEnabled === false
    );

    const upstreamBase = upstreamBaseFrom(raw);
    if (!upstreamBase) {
      return NextResponse.json(
        {
          ok: false,
          error: "service_not_configured",
          detail: "请配置 NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL",
        } satisfies EoBurnInOverlayResult,
        { status: 503 },
      );
    }

    const body: Record<string, unknown> = { entityId, hideOverlay, checked: hideOverlay };
    if (raw.cameraIndex != null && Number.isFinite(Number(raw.cameraIndex)))
      body.cameraIndex = Math.trunc(Number(raw.cameraIndex));

    const url = `${upstreamBase}/api/v1/burn-in/overlay`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const text = await upstream.text();
    let data: EoBurnInOverlayResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as EoBurnInOverlayResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies EoBurnInOverlayResult,
      { status: 502 },
    );
  }
}
