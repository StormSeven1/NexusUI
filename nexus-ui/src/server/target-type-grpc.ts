/**
 * TrackManager TargetTypeService.UpdateTargetType（默认 192.168.18.141:60054）。
 * 对齐 AlarmSys `TargetTypeGrpcClient::updateTargetType`。
 */
import path from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export type SeaManualTargetType = "ship" | "buoy" | "other";

export type TargetTypeGrpcResult = {
  ok: boolean;
  target: string;
  targetId: string;
  targetType: string;
  accepted?: boolean;
  reason?: string;
  error?: string;
};

type TargetTypeClient = {
  UpdateTargetType: (
    req: { targetID: string; targetType: string },
    options: { deadline: Date },
    cb: (
      err: grpc.ServiceError | null,
      res?: {
        accepted?: boolean;
        targetID?: string;
        targetType?: string;
        reason?: string;
        serverTime?: number;
      },
    ) => void,
  ) => void;
  close: () => void;
};

const DEFAULT_GRPC_ADDR = "192.168.18.141:60054";
const REQUEST_TIMEOUT_MS = 5_000;
const ALLOWED: ReadonlySet<string> = new Set([
  "ship",
  "yacht",
  "cargo",
  "fishing",
  "buoy",
  "uav",
  "bird",
  "other",
]);

let cachedClient: TargetTypeClient | null = null;
let cachedTarget = "";

export function getTargetTypeGrpcTarget(): string {
  const explicit =
    process.env.NEXUS_TARGET_TYPE_GRPC_URL?.trim() ||
    process.env.NEXUS_TARGET_TYPE_GRPC_ADDR?.trim();
  if (explicit) return explicit.replace(/^grpc:\/\//, "");
  return DEFAULT_GRPC_ADDR;
}

export function canonicalizeTargetType(raw: string): SeaManualTargetType | null {
  const s = raw.trim().toLowerCase();
  if (s === "ship" || s === "buoy" || s === "other") return s;
  return null;
}

function getClient(): TargetTypeClient {
  const target = getTargetTypeGrpcTarget();
  if (cachedClient && cachedTarget === target) return cachedClient;

  if (cachedClient) cachedClient.close();

  const protoPath = path.join(process.cwd(), "proto", "target_type.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject;
  const pkg = loaded.targetTypePkg as grpc.GrpcObject;
  const ClientCtor = pkg.TargetTypeService as grpc.ServiceClientConstructor;
  if (typeof ClientCtor !== "function") {
    throw new Error("TargetTypeService client constructor not found in target_type.proto");
  }
  cachedClient = new ClientCtor(target, grpc.credentials.createInsecure()) as unknown as TargetTypeClient;
  cachedTarget = target;
  return cachedClient;
}

export function updateTargetTypeViaGrpc(
  targetId: string | number,
  targetType: string,
): Promise<TargetTypeGrpcResult> {
  const id = String(targetId ?? "").trim();
  const canonical = canonicalizeTargetType(targetType);
  const target = getTargetTypeGrpcTarget();

  if (!id) {
    return Promise.resolve({
      ok: false,
      target,
      targetId: id,
      targetType: String(targetType ?? ""),
      error: "invalid targetId",
    });
  }
  if (!canonical || !ALLOWED.has(canonical)) {
    return Promise.resolve({
      ok: false,
      target,
      targetId: id,
      targetType: String(targetType ?? ""),
      error: `invalid targetType (allowed: ship/buoy/other)`,
    });
  }

  let client: TargetTypeClient;
  try {
    client = getClient();
  } catch (e) {
    return Promise.resolve({
      ok: false,
      target,
      targetId: id,
      targetType: canonical,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return new Promise((resolve) => {
    client.UpdateTargetType(
      { targetID: id, targetType: canonical },
      { deadline: new Date(Date.now() + REQUEST_TIMEOUT_MS) },
      (err, res) => {
        if (err) {
          cachedClient = null;
          cachedTarget = "";
          resolve({
            ok: false,
            target,
            targetId: id,
            targetType: canonical,
            error: err.message || `gRPC ${err.code}`,
          });
          return;
        }
        const accepted = res?.accepted === true;
        resolve({
          ok: accepted,
          target,
          targetId: res?.targetID ?? id,
          targetType: res?.targetType ?? canonical,
          accepted,
          reason: res?.reason,
          error: accepted ? undefined : res?.reason || "not accepted",
        });
      },
    );
  });
}
