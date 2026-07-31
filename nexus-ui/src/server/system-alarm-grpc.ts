/**
 * AlarmSys SystemAlarmService.GetActiveAlarms（默认 192.168.18.141:25071）。
 */
import path from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export const SYSTEM_ALARM_SOURCE = "SystemAlarm" as const;

/** proto AlarmKind 数值 → 中文 */
export const SYSTEM_ALARM_KIND_LABEL: Record<number, string> = {
  1: "装备状态",
  2: "数据通信",
  3: "任务",
  4: "环境",
  5: "综合",
  6: "系统权鉴",
};

export type SystemAlarmKindCode =
  | "EQUIPMENT"
  | "DATA_COMM"
  | "TASK"
  | "ENVIRONMENT"
  | "COMPREHENSIVE"
  | "SYSTEM_AUTH";

export const SYSTEM_ALARM_KIND_CODE: Record<number, SystemAlarmKindCode> = {
  1: "EQUIPMENT",
  2: "DATA_COMM",
  3: "TASK",
  4: "ENVIRONMENT",
  5: "COMPREHENSIVE",
  6: "SYSTEM_AUTH",
};

export type SystemAlarmDto = {
  alarmId: string;
  systemId: string;
  description: string;
  timestampMs: number;
  raisedTimeMs: number;
  canceledTimeMs: number;
  alarmKind: number;
  alarmKindCode: SystemAlarmKindCode | "";
  alarmKindLabel: string;
  entityId: string;
  level: number; // 0 LOW / 1 MEDIUM / 2 HIGH
  reserved1: string;
  reserved2: string;
  reserved3: string;
};

type GetActiveAlarmsResponse = {
  alarms?: Array<{
    alarm_id?: string;
    system_id?: string;
    description?: string;
    timestamp_ms?: string | number;
    raised_time_ms?: string | number;
    canceled_time_ms?: string | number;
    alarm_kind?: number;
    entity_id?: string;
    level?: number;
    reserved1?: string;
    reserved2?: string;
    reserved3?: string;
  }>;
  server_time_ms?: string | number;
};

type SystemAlarmClient = {
  GetActiveAlarms: (
    req: {
      system_id?: string;
      alarm_kind?: number;
      level_filter_set?: boolean;
      level?: number;
    },
    options: { deadline: Date },
    cb: (err: grpc.ServiceError | null, res?: GetActiveAlarmsResponse) => void,
  ) => void;
  CancelAlarm: (
    req: {
      alarm_id: string;
      system_id: string;
      timestamp_ms: number | string;
      canceled_time_ms: number | string;
      reason?: string;
    },
    options: { deadline: Date },
    cb: (
      err: grpc.ServiceError | null,
      res?: { ok?: boolean; message?: string; server_time_ms?: string | number },
    ) => void,
  ) => void;
  close: () => void;
};

const DEFAULT_GRPC_ADDR = "192.168.18.141:25071";
const REQUEST_TIMEOUT_MS = 4_000;

let cachedClient: SystemAlarmClient | null = null;
let cachedTarget = "";

export function getSystemAlarmGrpcTarget(): string {
  const explicit =
    process.env.NEXUS_SYSTEM_ALARM_GRPC_URL?.trim() ||
    process.env.NEXUS_SYSTEM_ALARM_GRPC_ADDR?.trim();
  if (explicit) return explicit.replace(/^grpc:\/\//, "");
  return DEFAULT_GRPC_ADDR;
}

function toInt64(v: string | number | undefined | null): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function getClient(): SystemAlarmClient {
  const target = getSystemAlarmGrpcTarget();
  if (cachedClient && cachedTarget === target) return cachedClient;

  if (cachedClient) {
    try {
      cachedClient.close();
    } catch {
      /* ignore */
    }
  }

  const protoPath = path.join(process.cwd(), "proto", "system_alarm.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as grpc.GrpcObject;
  const alarmsys = loaded.alarmsys as grpc.GrpcObject | undefined;
  const grpcNs = alarmsys?.grpc as grpc.GrpcObject | undefined;
  const pkg = grpcNs?.system_alarm as grpc.GrpcObject | undefined;
  const ClientCtor = pkg?.SystemAlarmService as grpc.ServiceClientConstructor | undefined;
  if (typeof ClientCtor !== "function") {
    throw new Error("SystemAlarmService client constructor not found in system_alarm.proto");
  }
  cachedClient = new ClientCtor(target, grpc.credentials.createInsecure()) as unknown as SystemAlarmClient;
  cachedTarget = target;
  return cachedClient;
}

export type GetActiveSystemAlarmsResult = {
  ok: boolean;
  target: string;
  alarms: SystemAlarmDto[];
  serverTimeMs?: number;
  error?: string;
};

export function getActiveSystemAlarmsViaGrpc(): Promise<GetActiveSystemAlarmsResult> {
  const target = getSystemAlarmGrpcTarget();
  let client: SystemAlarmClient;
  try {
    client = getClient();
  } catch (e) {
    return Promise.resolve({
      ok: false,
      target,
      alarms: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return new Promise((resolve) => {
    client.GetActiveAlarms(
      {
        system_id: "",
        alarm_kind: 0,
        level_filter_set: false,
        level: 0,
      },
      { deadline: new Date(Date.now() + REQUEST_TIMEOUT_MS) },
      (err, res) => {
        if (err) {
          cachedClient = null;
          cachedTarget = "";
          resolve({
            ok: false,
            target,
            alarms: [],
            error: err.message || `gRPC ${err.code}`,
          });
          return;
        }
        const raw = Array.isArray(res?.alarms) ? res!.alarms! : [];
        const alarms: SystemAlarmDto[] = [];
        for (const a of raw) {
          const alarmId = String(a.alarm_id ?? "").trim();
          if (!alarmId) continue;
          const kind = typeof a.alarm_kind === "number" ? a.alarm_kind : Number(a.alarm_kind) || 0;
          if (kind < 1 || kind > 6) continue;
          alarms.push({
            alarmId,
            systemId: String(a.system_id ?? "").trim(),
            description: String(a.description ?? "").trim(),
            timestampMs: toInt64(a.timestamp_ms),
            raisedTimeMs: toInt64(a.raised_time_ms),
            canceledTimeMs: toInt64(a.canceled_time_ms),
            alarmKind: kind,
            alarmKindCode: SYSTEM_ALARM_KIND_CODE[kind] ?? "",
            alarmKindLabel: SYSTEM_ALARM_KIND_LABEL[kind] ?? "系统告警",
            entityId: String(a.entity_id ?? "").trim(),
            level: typeof a.level === "number" ? a.level : Number(a.level) || 0,
            reserved1: String(a.reserved1 ?? ""),
            reserved2: String(a.reserved2 ?? ""),
            reserved3: String(a.reserved3 ?? ""),
          });
        }
        resolve({
          ok: true,
          target,
          alarms,
          serverTimeMs: toInt64(res?.server_time_ms),
        });
      },
    );
  });
}

export type CancelSystemAlarmResult = {
  ok: boolean;
  target: string;
  message?: string;
  serverTimeMs?: number;
  error?: string;
};

export function cancelSystemAlarmViaGrpc(params: {
  alarmId: string;
  systemId: string;
  reason?: string;
  timestampMs?: number;
  canceledTimeMs?: number;
}): Promise<CancelSystemAlarmResult> {
  const target = getSystemAlarmGrpcTarget();
  const alarmId = String(params.alarmId ?? "").trim();
  const systemId = String(params.systemId ?? "").trim();
  const now = Date.now();
  const timestampMs = params.timestampMs && params.timestampMs > 0 ? params.timestampMs : now;
  const canceledTimeMs =
    params.canceledTimeMs && params.canceledTimeMs > 0 ? params.canceledTimeMs : now;

  if (!alarmId || !systemId) {
    return Promise.resolve({
      ok: false,
      target,
      error: "invalid_param: alarmId/systemId required",
    });
  }

  let client: SystemAlarmClient;
  try {
    client = getClient();
  } catch (e) {
    return Promise.resolve({
      ok: false,
      target,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return new Promise((resolve) => {
    client.CancelAlarm(
      {
        alarm_id: alarmId,
        system_id: systemId,
        timestamp_ms: timestampMs,
        canceled_time_ms: canceledTimeMs,
        reason: params.reason?.trim() || "NexusUI dismiss",
      },
      { deadline: new Date(Date.now() + REQUEST_TIMEOUT_MS) },
      (err, res) => {
        if (err) {
          cachedClient = null;
          cachedTarget = "";
          resolve({
            ok: false,
            target,
            error: err.message || `gRPC ${err.code}`,
          });
          return;
        }
        const ok = res?.ok === true;
        resolve({
          ok,
          target,
          message: res?.message,
          serverTimeMs: toInt64(res?.server_time_ms),
          error: ok ? undefined : res?.message || "not accepted",
        });
      },
    );
  });
}
