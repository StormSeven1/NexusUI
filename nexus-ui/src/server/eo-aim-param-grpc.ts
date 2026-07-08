import path from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import {
  camConfAimPathForGrpc,
  type CalcRecordKind,
} from "@/lib/eo-calc-record/eoCalcRecordStorage.server";

export type AimParamGrpcSeaAim = {
  minAzi?: number;
  maxAzi?: number;
  minDis?: number;
  maxDis?: number;
  seamParamP?: string;
  seamParamT?: string;
};

export type AimParamGrpcResponse = {
  cameraIndex: number;
  aimType: number;
  seamParam: AimParamGrpcSeaAim[];
  skyParam?: { skyParamT?: string };
};

export type AimParamGrpcResult = {
  ok: boolean;
  target: string;
  aimPath: string;
  response?: AimParamGrpcResponse;
  error?: string;
  detail?: string;
};

type AimparamClient = {
  StreamAim: () => grpc.ClientDuplexStream<
    { cameraIndex: number; aimType: number; aimPath: string },
    AimParamGrpcResponse
  >;
  close: () => void;
};

type PendingAim = {
  params: { cameraIndex: number; aimType: 0 | 1; aimPath: string };
  resolve: (result: AimParamGrpcResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

let cachedClient: AimparamClient | null = null;
let cachedTarget = "";
let activeStream: grpc.ClientDuplexStream<
  { cameraIndex: number; aimType: number; aimPath: string },
  AimParamGrpcResponse
> | null = null;
let pending: PendingAim | null = null;

const DEFAULT_GRPC_ADDR = "192.168.18.108:50052";
const REQUEST_TIMEOUT_MS = 15_000;

export function getAimParamGrpcTarget(): string {
  const explicit = process.env.NEXUS_EO_AIM_PARAM_GRPC_ADDR?.trim();
  if (explicit) return explicit.replace(/^grpc:\/\//, "");
  return DEFAULT_GRPC_ADDR;
}

/** 对齐 Qt `PtzMainWidget::slot_calcParam` / `slot_calcSkyParam` 的路径格式 */
export function formatAimPathForGrpc(cameraIndex: number, kind: CalcRecordKind): string {
  return camConfAimPathForGrpc(cameraIndex, kind);
}

function getClient(): AimparamClient {
  const target = getAimParamGrpcTarget();
  if (cachedClient && cachedTarget === target) return cachedClient;

  resetStream();
  if (cachedClient) cachedClient.close();

  const protoPath = path.join(process.cwd(), "proto", "aimparam.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject;
  const pkg = loaded.aimparam as grpc.GrpcObject;
  const ClientCtor = pkg.Aimparam as grpc.ServiceClientConstructor;
  if (typeof ClientCtor !== "function") {
    throw new Error("Aimparam client constructor not found in aimparam.proto");
  }
  cachedClient = new ClientCtor(target, grpc.credentials.createInsecure()) as unknown as AimparamClient;
  cachedTarget = target;
  return cachedClient;
}

function resetStream(): void {
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve({
      ok: false,
      target: getAimParamGrpcTarget(),
      aimPath: pending.params.aimPath,
      error: "aim_param_interrupted",
      detail: "stream reset",
    });
    pending = null;
  }
  if (!activeStream) return;
  activeStream.removeAllListeners();
  try {
    activeStream.destroy();
  } catch {
    // ignore
  }
  activeStream = null;
}

function ensureStream(target: string): void {
  if (activeStream) return;
  const client = getClient();
  const stream = client.StreamAim();
  activeStream = stream;

  stream.on("data", (response: AimParamGrpcResponse) => {
    if (!pending) return;
    if (response.cameraIndex !== pending.params.cameraIndex || response.aimType !== pending.params.aimType) {
      return;
    }
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.resolve({
      ok: true,
      target,
      aimPath: current.params.aimPath,
      response: {
        cameraIndex: response.cameraIndex,
        aimType: response.aimType,
        seamParam: Array.isArray(response.seamParam) ? response.seamParam : [],
        skyParam: response.skyParam,
      },
    });
  });

  stream.on("error", (err: grpc.ServiceError) => {
    if (err.code === grpc.status.CANCELLED) return;
    const current = pending;
    pending = null;
    resetStream();
    if (!current) return;
    clearTimeout(current.timer);
    current.resolve({
      ok: false,
      target,
      aimPath: current.params.aimPath,
      error: "grpc_call_failed",
      detail: err.message,
    });
  });

  stream.on("end", () => {
    const current = pending;
    pending = null;
    activeStream = null;
    if (!current) return;
    clearTimeout(current.timer);
    current.resolve({
      ok: false,
      target,
      aimPath: current.params.aimPath,
      error: "aim_param_stream_ended",
      detail: "stream closed before matching response",
    });
  });
}

export function sendAimParamViaGrpc(params: {
  cameraIndex: number;
  aimType: 0 | 1;
  aimPath: string;
}): Promise<AimParamGrpcResult> {
  const target = getAimParamGrpcTarget();
  if (pending) {
    return Promise.resolve({
      ok: false,
      target,
      aimPath: params.aimPath,
      error: "aim_param_busy",
      detail: "another aim param request is in progress",
    });
  }

  ensureStream(target);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pending) return;
      const current = pending;
      pending = null;
      current.resolve({
        ok: false,
        target,
        aimPath: current.params.aimPath,
        error: "aim_param_timeout",
        detail: `no response within ${REQUEST_TIMEOUT_MS}ms`,
      });
    }, REQUEST_TIMEOUT_MS);

    pending = { params, resolve, timer };
    try {
      activeStream!.write({
        cameraIndex: params.cameraIndex,
        aimType: params.aimType,
        aimPath: params.aimPath,
      });
    } catch (e) {
      clearTimeout(timer);
      pending = null;
      resetStream();
      resolve({
        ok: false,
        target,
        aimPath: params.aimPath,
        error: "grpc_write_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
