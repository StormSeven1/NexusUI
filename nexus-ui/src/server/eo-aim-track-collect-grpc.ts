import path from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import type { AimTrackCollectRequest } from "@/lib/eo-aim-collect/aimTrackCollectTypes";

export type AimTrackCollectGrpcResponse = {
  cameraIndex: number;
  aimType: number;
};

export type AimTrackCollectGrpcResult = {
  ok: boolean;
  target: string;
  response?: AimTrackCollectGrpcResponse;
  error?: string;
  detail?: string;
};

type TrackServiceClient = {
  StreamTrack: () => grpc.ClientDuplexStream<AimTrackCollectRequest, AimTrackCollectGrpcResponse>;
  close: () => void;
};

type PendingCollect = {
  params: AimTrackCollectRequest;
  resolve: (result: AimTrackCollectGrpcResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

let cachedClient: TrackServiceClient | null = null;
let cachedTarget = "";
let activeStream: grpc.ClientDuplexStream<
  AimTrackCollectRequest,
  AimTrackCollectGrpcResponse
> | null = null;
let pending: PendingCollect | null = null;

const DEFAULT_GRPC_ADDR = "192.168.18.108:50055";
const REQUEST_TIMEOUT_MS = 15_000;

function normalizeGrpcTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^grpc:\/\//, "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function getAimTrackCollectGrpcTarget(): string {
  const explicit =
    process.env.NEXUS_EO_AIM_TRACK_COLLECT_GRPC_ADDR?.trim() ||
    process.env.NEXUS_EO_AIM_TRACK_COLLECT_URL?.trim() ||
    process.env.EO_AIM_TRACK_COLLECT_URL?.trim() ||
    "";
  const normalized = normalizeGrpcTarget(explicit);
  return normalized || DEFAULT_GRPC_ADDR;
}

function getClient(): TrackServiceClient {
  const target = getAimTrackCollectGrpcTarget();
  if (cachedClient && cachedTarget === target) return cachedClient;

  resetStream();
  if (cachedClient) cachedClient.close();

  const protoPath = path.join(process.cwd(), "proto", "track.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject;
  const pkg = loaded.track as grpc.GrpcObject;
  const ClientCtor = pkg.TrackService as grpc.ServiceClientConstructor;
  if (typeof ClientCtor !== "function") {
    throw new Error("TrackService client constructor not found in track.proto");
  }
  cachedClient = new ClientCtor(target, grpc.credentials.createInsecure()) as unknown as TrackServiceClient;
  cachedTarget = target;
  return cachedClient;
}

function resetStream(): void {
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve({
      ok: false,
      target: getAimTrackCollectGrpcTarget(),
      error: "aim_track_collect_interrupted",
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
  const stream = client.StreamTrack();
  activeStream = stream;

  stream.on("data", (response: AimTrackCollectGrpcResponse) => {
    if (!pending) return;
    if (
      response.cameraIndex !== pending.params.cameraIndex ||
      response.aimType !== pending.params.aimType
    ) {
      return;
    }
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    current.resolve({
      ok: true,
      target,
      response: {
        cameraIndex: response.cameraIndex,
        aimType: response.aimType,
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
      error: "aim_track_collect_stream_ended",
      detail: "stream closed before matching response",
    });
  });
}

export function sendAimTrackCollectViaGrpc(
  params: AimTrackCollectRequest,
): Promise<AimTrackCollectGrpcResult> {
  const target = getAimTrackCollectGrpcTarget();
  if (pending) {
    return Promise.resolve({
      ok: false,
      target,
      error: "aim_track_collect_busy",
      detail: "another aim track collect request is in progress",
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
        error: "aim_track_collect_timeout",
        detail: `no response within ${REQUEST_TIMEOUT_MS}ms`,
      });
    }, REQUEST_TIMEOUT_MS);

    pending = { params, resolve, timer };
    try {
      console.info("[eo-aim-track-collect] send gRPC", {
        target,
        triggerType: params.triggerType,
        cameraIndex: params.cameraIndex,
        aimType: params.aimType,
        trackPoints: params.trackPoints,
      });
      activeStream!.write(params);
    } catch (e) {
      clearTimeout(timer);
      pending = null;
      resetStream();
      resolve({
        ok: false,
        target,
        error: "grpc_write_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
