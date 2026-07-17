import { NextRequest, NextResponse } from "next/server";

import type { AimTrackCollectRequest } from "@/lib/eo-aim-collect/aimTrackCollectTypes";
import {
  getAimTrackCollectGrpcTarget,
  sendAimTrackCollectViaGrpc,
} from "@/server/eo-aim-track-collect-grpc";

export const runtime = "nodejs";

function defaultAimPath(): string {
  return (
    process.env.NEXUS_EO_AIM_TRACK_COLLECT_AIM_PATH?.trim() ||
    process.env.NEXUS_EO_AIM_PARAM_AIM_PATH_ROOT?.trim() ||
    ""
  );
}

function parseTrackCollectBody(body: Record<string, unknown>): AimTrackCollectRequest | null {
  const cameraIndex = Math.trunc(Number(body.cameraIndex));
  const aimType = Math.trunc(Number(body.aimType));
  const triggerType = Math.trunc(Number(body.triggerType ?? 1));
  const trackStatus = Math.trunc(Number(body.trackStatus ?? 1));
  if (!Number.isFinite(cameraIndex) || cameraIndex < 0) return null;
  if (!Number.isFinite(aimType) || (aimType !== 0 && aimType !== 1)) return null;
  if (!Number.isFinite(triggerType) || !Number.isFinite(trackStatus)) return null;

  const trackPointsRaw = body.trackPoints;
  const trackPoints = Array.isArray(trackPointsRaw)
    ? trackPointsRaw.map((item) => String(item)).filter(Boolean)
    : [];
  if (trackPoints.length === 0) return null;

  const aimPath = String(body.aimPath ?? "").trim() || defaultAimPath();
  return {
    cameraIndex,
    aimType,
    aimPath,
    triggerType,
    trackStatus,
    trackPoints,
    interventionStatus: String(body.interventionStatus ?? "1"),
    backupField: String(body.backupField ?? ""),
  };
}

/** 对齐 108:50055 `track.TrackService/StreamTrack` gRPC 上报 TrackRequest */
export async function POST(req: NextRequest) {
  const target = getAimTrackCollectGrpcTarget();
  if (!target) {
    return NextResponse.json(
      {
        ok: false,
        error: "service_not_configured",
        detail: "请配置 NEXUS_EO_AIM_TRACK_COLLECT_URL 或 NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const payload = parseTrackCollectBody(body);
    if (!payload) {
      return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
    }

    const result = await sendAimTrackCollectViaGrpc(payload);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error ?? "aim_track_collect_failed",
          detail: result.detail,
          target: result.target || target,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      transport: "grpc",
      target: result.target,
      cameraIndex: result.response?.cameraIndex,
      aimType: result.response?.aimType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "aim_track_collect_failed", detail: msg }, { status: 502 });
  }
}
