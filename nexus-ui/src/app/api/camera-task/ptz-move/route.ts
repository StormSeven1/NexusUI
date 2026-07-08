import { NextRequest, NextResponse } from "next/server";

import {
  buildPtzMoveTaskPayload,
  resolveCameraTaskHttpEndpoint,
  type EoPtzDirection,
} from "@/server/camera-task-payload";
import { withCameraTaskEntityLock } from "@/server/camera-task-entity-queue";
import {
  isCameraTaskGrpcTransport,
  ptzMoveViaGrpc,
  submitCameraTaskViaHttp,
} from "@/server/camera-task-transport";

const ALLOWED_DIRECTIONS = new Set<EoPtzDirection>([
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
  "LEFT_UP",
  "LEFT_DOWN",
  "RIGHT_UP",
  "RIGHT_DOWN",
  "ZOOM_IN",
  "ZOOM_OUT",
  "FOCUS_IN",
  "FOCUS_OUT",
]);

function parseMoveSpeed(raw: unknown): { pan?: number; tilt?: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as { pan?: unknown; tilt?: unknown };
  const pan = s.pan != null ? Number(s.pan) : undefined;
  const tilt = s.tilt != null ? Number(s.tilt) : undefined;
  if (pan == null && tilt == null) return undefined;
  return {
    ...(Number.isFinite(pan) ? { pan } : {}),
    ...(Number.isFinite(tilt) ? { tilt } : {}),
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
    direction?: unknown;
    speed?: unknown;
  };
  const entityId = String(payloadIn.entityId ?? "").trim().toLowerCase();
  const backendBaseUrl = String(payloadIn.backendBaseUrl ?? "").trim();
  const direction = String(payloadIn.direction ?? "").trim().toUpperCase() as EoPtzDirection;
  const speed = parseMoveSpeed(payloadIn.speed);

  if (!/^camera_\d{3}$/.test(entityId)) {
    return NextResponse.json({ error: "invalid entityId" }, { status: 400 });
  }
  if (!ALLOWED_DIRECTIONS.has(direction)) {
    return NextResponse.json({ error: "invalid direction" }, { status: 400 });
  }

  if (isCameraTaskGrpcTransport()) {
    try {
      const result = await withCameraTaskEntityLock(entityId, () =>
        ptzMoveViaGrpc({ entityId, direction, speed }),
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
      return NextResponse.json({ error: "ptz grpc failed", detail }, { status: 502 });
    }
  }

  const target = resolveCameraTaskHttpEndpoint(backendBaseUrl);
  if (!target) {
    return NextResponse.json({ error: "invalid backendBaseUrl" }, { status: 400 });
  }

  const taskPayload = buildPtzMoveTaskPayload({ entityId, direction, speed });
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
