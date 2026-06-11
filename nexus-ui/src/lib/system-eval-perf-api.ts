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

function formatPerfHttpError(
  res: Response,
  raw: string,
  json: SystemPerfJson | null,
): string {
  if (json) {
    const parts = [
      json.message,
      json.error,
      json.detail,
      json.backend ? `backend=${json.backend}` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  }
  const preview = raw.trim().slice(0, 120);
  if (preview.startsWith("<!")) {
    return "接口返回了 HTML 而非 JSON，请确认 Next.js 已配置 /api/system-eval/perf 代理且 Custombackend 已启动";
  }
  if (preview === "Internal Server Error") {
    return "后端 500：Custombackend 可能缺少 grpcio，或 system-evaluation-server 未启动；请重启 Custombackend 并确认 pip 依赖已安装";
  }
  return preview ? `HTTP ${res.status}: ${preview}` : `HTTP ${res.status}`;
}

type SystemPerfJson = SystemPerfApiResponse & { error?: string; detail?: string; backend?: string };

export async function fetchSystemPerfStats(limit = 10): Promise<{
  stats: SystemResponseTimeStats | null;
  error: string | null;
  fetchedAt: string;
}> {
  const res = await fetch(`/api/system-eval/perf?limit=${limit}`, { cache: "no-store" });
  const raw = await res.text();
  let json: SystemPerfJson | null = null;
  try {
    json = raw.trim() ? (JSON.parse(raw) as SystemPerfJson) : null;
  } catch {
    return {
      stats: null,
      error: formatPerfHttpError(res, raw, null),
      fetchedAt: new Date().toISOString(),
    };
  }

  if (!res.ok || !json) {
    return {
      stats: null,
      error: formatPerfHttpError(res, raw, json),
      fetchedAt: new Date().toISOString(),
    };
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
