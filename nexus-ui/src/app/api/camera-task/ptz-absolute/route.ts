import { NextRequest, NextResponse } from "next/server";

import {
  buildPtzAbsolutePositionTaskPayload,
  resolveCameraTaskHttpEndpoint,
} from "@/server/camera-task-payload";
import { withCameraTaskEntityLock } from "@/server/camera-task-entity-queue";
import {
  isCameraTaskGrpcTransport,
  submitCameraTaskViaGrpc,
  submitCameraTaskViaHttp,
} from "@/server/camera-task-transport";

function parseAbsSpeed(raw: unknown): { pan?: number; tilt?: number; zoom?: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as { pan?: unknown; tilt?: unknown; zoom?: unknown };
  const pan = s.pan != null ? Number(s.pan) : undefined;
  const tilt = s.tilt != null ? Number(s.tilt) : undefined;
  const zoom = s.zoom != null ? Number(s.zoom) : undefined;
  if (pan == null && tilt == null && zoom == null) return undefined;
  return {
    ...(Number.isFinite(pan) ? { pan } : {}),
    ...(Number.isFinite(tilt) ? { tilt } : {}),
    ...(Number.isFinite(zoom) ? { zoom } : {}),
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payloadIn = body as {
    entityId?: unknown;
    backendBaseUrl?: unknown;
    panDeg?: unknown;
    tiltDeg?: unknown;
    zoom?: unknown;
    speed?: unknown;
  };
  const entityId = String(payloadIn.entityId ?? "").trim().toLowerCase();
  const backendBaseUrl = String(payloadIn.backendBaseUrl ?? "").trim();
  const panDeg = Number(payloadIn.panDeg);
  const tiltDeg = Number(payloadIn.tiltDeg);
  const zoom = Number(payloadIn.zoom);
  const speed = parseAbsSpeed(payloadIn.speed);

  if (!/^camera_\d{3}$/.test(entityId)) {
    return NextResponse.json({ error: "invalid entityId" }, { status: 400 });
  }
  if (!Number.isFinite(panDeg) || !Number.isFinite(tiltDeg) || !Number.isFinite(zoom)) {
    return NextResponse.json({ error: "invalid panDeg/tiltDeg/zoom" }, { status: 400 });
  }

  const taskPayload = buildPtzAbsolutePositionTaskPayload({
    entityId,
    panDeg,
    tiltDeg,
    zoom,
    speed,
  });

  if (isCameraTaskGrpcTransport()) {
    try {
      const result = await withCameraTaskEntityLock(entityId, () =>
        submitCameraTaskViaGrpc(taskPayload),
      );
      return new NextResponse(result.body, {
        status: result.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Camera-Task-Transport": result.transport,
          "X-Camera-Task-Target": result.target,
        },
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: "ptz absolute grpc failed", detail }, { status: 502 });
    }
  }

  const target = resolveCameraTaskHttpEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const result = await withCameraTaskEntityLock(entityId, () =>
    submitCameraTaskViaHttp(target, taskPayload),
  );
  return new NextResponse(result.body, {
    status: result.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Camera-Task-Transport": result.transport,
      "X-Camera-Task-Target": result.target,
    },
  });
}
