import { NextRequest, NextResponse } from "next/server";

import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";
import {
  parseMotionCamera,
  parseMotionFields,
  type FetchEoMotionParamsResult,
  type MotionCameraParams,
  type MotionParamsFields,
} from "@/lib/eo-video/eoMotionParamsClient";

export const runtime = "nodejs";

/**
 * 浏览器 → camServer `GET /api/v1/motion-params`
 * Query: `backendBaseUrl` 可选（覆盖默认管理地址）
 */
export async function GET(req: NextRequest) {
  try {
    const upstreamBase = (
      (req.nextUrl.searchParams.get("backendBaseUrl") ?? "").trim() || getCameraEntityBaseUrl()
    ).replace(/\/+$/, "");
    if (!upstreamBase) {
      return NextResponse.json(
        {
          ok: false,
          error: "service_not_configured",
          detail: "请配置 NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL",
        } satisfies FetchEoMotionParamsResult,
        { status: 503 },
      );
    }

    const url = `${upstreamBase}/api/v1/motion-params`;
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    let data: FetchEoMotionParamsResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as FetchEoMotionParamsResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }

    if (data.ok) {
      const global = parseMotionFields(data.global) ?? undefined;
      const cameras: MotionCameraParams[] = [];
      if (Array.isArray(data.cameras)) {
        for (const raw of data.cameras) {
          const c = parseMotionCamera(raw, global);
          if (c) cameras.push(c);
        }
      }
      data = { ok: true, global, cameras };
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies FetchEoMotionParamsResult,
      { status: 502 },
    );
  }
}

/**
 * 浏览器 → camServer `POST /api/v1/motion-params`
 * Body: `{ cameraIndex|entityId, camera: MotionParamsFields, backendBaseUrl? }`
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      cameraIndex?: unknown;
      entityId?: unknown;
      camera?: unknown;
      global?: unknown;
      backendBaseUrl?: string;
    };

    const cameraIndex =
      typeof body.cameraIndex === "number"
        ? Math.trunc(body.cameraIndex)
        : Number.isFinite(Number(body.cameraIndex))
          ? Math.trunc(Number(body.cameraIndex))
          : -1;
    const entityId = typeof body.entityId === "string" ? body.entityId.trim() : "";
    const cameraFields = parseMotionFields(body.camera);
    if (!cameraFields || (cameraIndex < 0 && !entityId)) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_camera",
          detail: "need body.cameraIndex|entityId and body.camera with motion fields",
        },
        { status: 400 },
      );
    }

    const upstreamBase = (
      (typeof body.backendBaseUrl === "string" ? body.backendBaseUrl : "").trim() ||
      getCameraEntityBaseUrl()
    ).replace(/\/+$/, "");
    if (!upstreamBase) {
      return NextResponse.json(
        {
          ok: false,
          error: "service_not_configured",
          detail: "请配置 NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL",
        } satisfies FetchEoMotionParamsResult,
        { status: 503 },
      );
    }

    const upstreamBody: Record<string, unknown> = {
      camera: cameraFields as MotionParamsFields,
    };
    if (cameraIndex >= 0) upstreamBody.cameraIndex = cameraIndex;
    if (entityId) upstreamBody.entityId = entityId;

    const url = `${upstreamBase}/api/v1/motion-params`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(upstreamBody),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    let data: FetchEoMotionParamsResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as FetchEoMotionParamsResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }

    if (data.ok) {
      const global = parseMotionFields(data.global) ?? undefined;
      const cameras: MotionCameraParams[] = [];
      if (Array.isArray(data.cameras)) {
        for (const raw of data.cameras) {
          const c = parseMotionCamera(raw, global);
          if (c) cameras.push(c);
        }
      }
      data = { ...data, ok: true, global, cameras };
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies FetchEoMotionParamsResult,
      { status: 502 },
    );
  }
}
