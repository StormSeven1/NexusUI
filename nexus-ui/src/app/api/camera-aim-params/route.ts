import { NextRequest, NextResponse } from "next/server";

import { getCameraEntityBaseUrl } from "@/lib/entityUpstream";
import {
  parseAimCamera,
  type AimCameraParams,
  type FetchEoAimParamsResult,
} from "@/lib/eo-video/eoAimParamsClient";

export const runtime = "nodejs";

/**
 * 浏览器 → camServer `GET /api/v1/aim-params`
 * Query: `backendBaseUrl` 可选
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
        } satisfies FetchEoAimParamsResult,
        { status: 503 },
      );
    }

    const url = `${upstreamBase}/api/v1/aim-params`;
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    let data: FetchEoAimParamsResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as FetchEoAimParamsResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }

    if (data.ok) {
      const cameras: AimCameraParams[] = [];
      if (Array.isArray(data.cameras)) {
        for (const raw of data.cameras) {
          const c = parseAimCamera(raw);
          if (c) cameras.push(c);
        }
      }
      data = { ok: true, cameras };
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies FetchEoAimParamsResult,
      { status: 502 },
    );
  }
}

/**
 * 浏览器 → camServer `POST /api/v1/aim-params`
 * Body: `{ cameraIndex, skyParamT, seaAimEnabled, skyAimEnabled, sea: AimSeaSegment[], backendBaseUrl? }`
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      cameraIndex?: unknown;
      skyParamT?: unknown;
      seaAimEnabled?: unknown;
      skyAimEnabled?: unknown;
      sea?: unknown;
      backendBaseUrl?: string;
    };
    const cameraIndex = Math.trunc(Number(body.cameraIndex));
    if (!Number.isFinite(cameraIndex) || cameraIndex < 0) {
      return NextResponse.json(
        { ok: false, error: "invalid_cameraIndex", detail: "need body.cameraIndex >= 0" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.sea)) {
      return NextResponse.json(
        { ok: false, error: "invalid_sea", detail: "need body.sea array" },
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
        } satisfies FetchEoAimParamsResult,
        { status: 503 },
      );
    }

    const seaAimEnabled =
      body.seaAimEnabled === true ||
      body.seaAimEnabled === 1 ||
      body.seaAimEnabled === "1" ||
      body.seaAimEnabled === "true";
    const skyAimEnabled =
      body.skyAimEnabled === true ||
      body.skyAimEnabled === 1 ||
      body.skyAimEnabled === "1" ||
      body.skyAimEnabled === "true";

    const payload = {
      cameraIndex,
      skyParamT: typeof body.skyParamT === "string" ? body.skyParamT : "",
      seaAimEnabled,
      skyAimEnabled,
      sea: body.sea,
    };

    const url = `${upstreamBase}/api/v1/aim-params`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await upstream.text();
    let data: FetchEoAimParamsResult = { ok: false };
    try {
      data = text ? (JSON.parse(text) as FetchEoAimParamsResult) : { ok: false, error: "empty_upstream" };
    } catch {
      data = { ok: false, error: "upstream_non_json", detail: text.slice(0, 500) };
    }

    if (data.ok) {
      const cameras: AimCameraParams[] = [];
      if (Array.isArray(data.cameras)) {
        for (const raw of data.cameras) {
          const c = parseAimCamera(raw);
          if (c) cameras.push(c);
        }
      }
      const camera = data.camera ? parseAimCamera(data.camera) : null;
      data = { ok: true, cameras, ...(camera ? { camera } : {}) };
    }

    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "upstream_fetch_failed", detail } satisfies FetchEoAimParamsResult,
      { status: 502 },
    );
  }
}
