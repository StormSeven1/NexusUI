import path from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import type { EoPtzDirection } from "@/server/camera-task-payload";
import { ptzDirectionToGrpcEnum } from "@/server/camera-task-payload";
import { normalizeCameraTaskResponseBody } from "@/server/camera-task-result";

export type CameraTaskTransportResult = {
  ok: boolean;
  status: number;
  body: string;
  transport: "http" | "grpc";
  target: string;
};

type CameraTaskClient = {
  PtzMove: (
    req: { entity_id: string; direction: number; speed?: { pan: number; tilt: number } },
    cb: (err: grpc.ServiceError | null, res?: { ok?: boolean; message?: string; task_id?: string }) => void,
  ) => void;
  PtzStop: (
    req: { entity_id: string },
    cb: (err: grpc.ServiceError | null, res?: { ok?: boolean; message?: string; task_id?: string }) => void,
  ) => void;
  SubmitTask: (
    req: { task_json: string },
    cb: (err: grpc.ServiceError | null, res?: { ok?: boolean; message?: string; task_id?: string }) => void,
  ) => void;
  close: () => void;
};

let cachedClient: CameraTaskClient | null = null;
let cachedTarget = "";

function getGrpcTarget(): string {
  const explicit = process.env.NEXUS_CAMERA_TASK_GRPC_URL?.trim();
  if (explicit) return explicit.replace(/^grpc:\/\//, "");

  const mgmt = process.env.NEXT_PUBLIC_NEXUS_CAMERA_MANAGEMENT_URL?.trim()
    ?? process.env.CAMERA_ENTITY_BASE_URL?.trim()
    ?? "http://192.168.18.141:8088";
  try {
    const u = new URL(mgmt);
    const port = process.env.NEXUS_CAMERA_TASK_GRPC_PORT?.trim() || "8086";
    return `${u.hostname}:${port}`;
  } catch {
    return "192.168.18.141:8086";
  }
}

function getClient(): CameraTaskClient {
  const target = getGrpcTarget();
  if (cachedClient && cachedTarget === target) return cachedClient;

  if (cachedClient) cachedClient.close();

  const protoPath = path.join(process.cwd(), "proto", "camera_task.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject;
  const pkg = loaded.cameraTaskPkg as grpc.GrpcObject;
  const ClientCtor = pkg.CameraTaskService as grpc.ServiceClientConstructor;
  if (typeof ClientCtor !== "function") {
    throw new Error("CameraTaskService client constructor not found in camera_task.proto");
  }
  cachedClient = new ClientCtor(
    target,
    grpc.credentials.createInsecure(),
  ) as unknown as CameraTaskClient;
  cachedTarget = target;
  return cachedClient;
}

function grpcResponseToResult(
  target: string,
  err: grpc.ServiceError | null,
  res?: { ok?: boolean; message?: string; task_id?: string },
): CameraTaskTransportResult {
  if (err) {
    return {
      ok: false,
      status: 502,
      transport: "grpc",
      target,
      body: JSON.stringify({ error: "grpc_call_failed", detail: err.message, code: err.code }),
    };
  }
  const ok = Boolean(res?.ok);
  const rawBody = JSON.stringify({
    ok,
    message: res?.message ?? "",
    taskId: res?.task_id ?? "",
  });
  const body = normalizeCameraTaskResponseBody(rawBody);
  let executed = ok;
  try {
    executed = Boolean(JSON.parse(body).ok);
  } catch {
    executed = ok;
  }
  return {
    ok: executed,
    status: executed ? 200 : 409,
    transport: "grpc",
    target,
    body,
  };
}

export function isCameraTaskGrpcTransport(): boolean {
  const mode = (process.env.NEXUS_CAMERA_TASK_TRANSPORT ?? "http").trim().toLowerCase();
  return mode === "grpc";
}

export async function submitCameraTaskViaGrpc(taskPayload: unknown): Promise<CameraTaskTransportResult> {
  const target = getGrpcTarget();
  const client = getClient();
  const taskJson = JSON.stringify(taskPayload);

  return new Promise((resolve) => {
    client.SubmitTask({ task_json: taskJson }, (err, res) => {
      resolve(grpcResponseToResult(target, err, res));
    });
  });
}

export async function ptzMoveViaGrpc(params: {
  entityId: string;
  direction: EoPtzDirection;
  speed?: { pan?: number; tilt?: number };
}): Promise<CameraTaskTransportResult> {
  const target = getGrpcTarget();
  const client = getClient();
  const zoomOrFocus = params.direction.includes("ZOOM") || params.direction.includes("FOCUS");
  const pan = params.speed?.pan ?? 0.5;
  const tilt = zoomOrFocus ? 0 : (params.speed?.tilt ?? 0.5);

  return new Promise((resolve) => {
    client.PtzMove(
      {
        entity_id: params.entityId,
        direction: ptzDirectionToGrpcEnum(params.direction),
        speed: zoomOrFocus ? { pan, tilt: 0 } : { pan, tilt },
      },
      (err, res) => resolve(grpcResponseToResult(target, err, res)),
    );
  });
}

export async function ptzStopViaGrpc(entityId: string): Promise<CameraTaskTransportResult> {
  const target = getGrpcTarget();
  const client = getClient();

  return new Promise((resolve) => {
    client.PtzStop({ entity_id: entityId }, (err, res) => {
      resolve(grpcResponseToResult(target, err, res));
    });
  });
}

export async function submitCameraTaskViaHttp(
  target: string,
  taskPayload: unknown,
): Promise<CameraTaskTransportResult> {
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(taskPayload),
      cache: "no-store",
    });
    const text = await upstream.text();
    const body = normalizeCameraTaskResponseBody(text);
    let executed = upstream.ok;
    try {
      executed = Boolean(JSON.parse(body).ok);
    } catch {
      executed = upstream.ok;
    }
    return {
      ok: executed,
      status: executed ? upstream.status : 409,
      body,
      transport: "http",
      target,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 502,
      body: JSON.stringify({ error: "ptz proxy failed", target, detail }),
      transport: "http",
      target,
    };
  }
}
