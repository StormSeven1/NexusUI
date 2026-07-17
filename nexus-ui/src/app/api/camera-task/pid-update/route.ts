import { NextRequest, NextResponse } from "next/server";

import {
  buildPidUpdateTaskPayload,
  resolveCameraTaskHttpEndpoint,
  type CameraPidParams,
} from "@/server/camera-task-payload";
import { withCameraTaskEntityLock } from "@/server/camera-task-entity-queue";
import {
  isCameraTaskGrpcTransport,
  submitCameraTaskViaGrpc,
  submitCameraTaskViaHttp,
} from "@/server/camera-task-transport";
import { parseCameraPid } from "@/lib/eo-video/eoPidClient";

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
    pid?: unknown;
  };
  const entityId = String(payloadIn.entityId ?? "").trim().toLowerCase();
  const backendBaseUrl = String(payloadIn.backendBaseUrl ?? "").trim();
  const pid = parseCameraPid(payloadIn.pid) as CameraPidParams | null;

  if (!/^camera_\d{3}$/.test(entityId)) {
    return NextResponse.json({ error: "invalid entityId" }, { status: 400 });
  }
  if (!pid) {
    return NextResponse.json({ error: "invalid pid", detail: "need 18 numeric fields px…dy2" }, { status: 400 });
  }

  const taskPayload = buildPidUpdateTaskPayload({ entityId, pid });

  if (isCameraTaskGrpcTransport()) {
    try {
      const result = await withCameraTaskEntityLock(entityId, () => submitCameraTaskViaGrpc(taskPayload));
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
      return NextResponse.json({ error: "pid grpc failed", detail }, { status: 502 });
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
