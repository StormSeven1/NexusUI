/** 系统性能评估 API 类型（对应 perf.eval.v1 SystemResponseTimeStats） */

export interface SystemResponseTimeStats {
  avg_threat_to_alarm_ms?: number;
  avg_alarm_to_rwgl_recv_ms?: number;
  avg_rwgl_recv_to_scheme_ms?: number;
  avg_scheme_to_task_dispatch_ms?: number;
  avg_task_dispatch_to_wrjgl_recv_ms?: number;
  fetched_record_count?: number;
  threat_to_alarm_count?: number;
  alarm_to_rwgl_recv_count?: number;
  rwgl_recv_to_scheme_count?: number;
  scheme_to_task_dispatch_count?: number;
  task_dispatch_to_wrjgl_recv_count?: number;
}

export interface SystemPerfApiResponse {
  code: number;
  message: string;
  data?: {
    stats?: SystemResponseTimeStats | null;
    error_message?: string | null;
    grpc_target?: string;
  };
  timestamp?: string;
}

export const SYSTEM_PERF_REFRESH_MS = 60 * 60 * 1000;

export const PERF_STAGE_LABELS: { key: keyof SystemResponseTimeStats; countKey: keyof SystemResponseTimeStats; label: string }[] = [
  { key: "avg_threat_to_alarm_ms", countKey: "threat_to_alarm_count", label: "威胁 → 告警" },
  { key: "avg_alarm_to_rwgl_recv_ms", countKey: "alarm_to_rwgl_recv_count", label: "告警 → 任务管理接收" },
  { key: "avg_rwgl_recv_to_scheme_ms", countKey: "rwgl_recv_to_scheme_count", label: "接收 → 生成方案" },
  { key: "avg_scheme_to_task_dispatch_ms", countKey: "scheme_to_task_dispatch_count", label: "生成方案 → 下发任务" },
  { key: "avg_task_dispatch_to_wrjgl_recv_ms", countKey: "task_dispatch_to_wrjgl_recv_count", label: "下发任务 → 设备接收" },
];

export async function fetchSystemPerfStats(limit = 10): Promise<{
  stats: SystemResponseTimeStats | null;
  error: string | null;
  fetchedAt: string;
}> {
  const res = await fetch(`/api/system-eval/perf?limit=${limit}`, { cache: "no-store" });
  const json = (await res.json()) as SystemPerfApiResponse & { error?: string; detail?: string };

  if (!res.ok) {
    const parts = [
      json.message,
      json.error,
      json.detail,
      (json as { backend?: string }).backend ? `backend=${(json as { backend?: string }).backend}` : null,
    ].filter(Boolean);
    const msg = parts.length > 0 ? parts.join(" · ") : `HTTP ${res.status}`;
    return { stats: null, error: msg, fetchedAt: new Date().toISOString() };
  }

  const stats = json.data?.stats ?? null;
  const grpcErr = json.data?.error_message?.trim();
  if (grpcErr && !stats) {
    return { stats: null, error: grpcErr, fetchedAt: new Date().toISOString() };
  }

  return {
    stats,
    error: grpcErr || null,
    fetchedAt: json.timestamp ?? new Date().toISOString(),
  };
}
