/** 航迹质量评估 API（经 Custombackend 转发 gRPC） */

import type { TrackEvalMetricsResult } from "@/lib/track-evaluation-metrics";
import { grpcResultToTrackEvalMetrics } from "@/lib/track-eval-grpc-adapter";

export interface TrackEvalGrpcRequest {
  start_time: string;
  end_time: string;
  scope?: "SEA" | "AIR" | "BOTH";
  sensor_ids?: number[];
  region_type?: "" | "rect" | "polygon";
  bounding_box?: {
    min_longitude: number;
    max_longitude: number;
    min_latitude: number;
    max_latitude: number;
  };
  polygon?: { points: Array<{ longitude: number; latitude: number }> };
  /** 显示筛选：四类航迹 ID（可多值）；融合 ID = unique_id/target_id */
  fusion_unique_ids?: number[];
  radar_track_ids?: number[];
  ais_ids?: number[];
  self_report_ids?: number[];
  attr_range?: {
    min_azimuth?: number;
    max_azimuth?: number;
    min_distance?: number;
    max_distance?: number;
    min_speed?: number;
    max_speed?: number;
    min_course?: number;
    max_course?: number;
    min_size?: number;
    max_size?: number;
  };
  sea_fusion_filter?: "ALL" | "WITH_AIS" | "WITHOUT_AIS";
  air_fusion_filter?: "ALL" | "WITH_SELF_REPORT" | "WITHOUT_SELF_REPORT";
  display_sensor_ids?: number[];
}

export interface TrackEvalGrpcApiResponse {
  code: number;
  message: string;
  data?: {
    result?: Record<string, unknown> | null;
    error_message?: string | null;
    grpc_target?: string;
  };
  timestamp?: string;
}

export function isTrackEvalGrpcEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_TRACK_EVAL_USE_GRPC?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 历史查询是否必须 C++ WS（gRPC 查询、直接下载除外） */
export function trackEvalHistoryQueryNeedsWs(directDownload: boolean): boolean {
  return directDownload || !isTrackEvalGrpcEnabled();
}

export async function fetchTrackEvalQuality(
  body: TrackEvalGrpcRequest,
  opts?: { signal?: AbortSignal },
): Promise<{
  metrics: TrackEvalMetricsResult | null;
  status: string;
  error: string | null;
  trackPointCount: number;
  fetchedAt: string;
}> {
  const res = await fetch("/api/system-eval/track/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      start_time: body.start_time,
      end_time: body.end_time,
      scope: body.scope ?? "BOTH",
      sensor_ids: body.sensor_ids,
      region_type: body.region_type ?? "",
      bounding_box: body.bounding_box,
      polygon: body.polygon,
      fusion_unique_ids: body.fusion_unique_ids,
      radar_track_ids: body.radar_track_ids,
      ais_ids: body.ais_ids,
      self_report_ids: body.self_report_ids,
      attr_range: body.attr_range,
      sea_fusion_filter: body.sea_fusion_filter,
      air_fusion_filter: body.air_fusion_filter,
      display_sensor_ids: body.display_sensor_ids,
    }),
    cache: "no-store",
    signal: opts?.signal,
  });

  const raw = await res.text();
  let json: TrackEvalGrpcApiResponse & { error?: string; detail?: string; message?: string };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    const preview = raw.trim().slice(0, 200);
    let hint: string;
    if (preview.startsWith("<!")) {
      hint =
        "接口返回了 HTML 而非 JSON，请确认 Next.js 已配置 /api/system-eval/track/evaluate 代理且 Custombackend 已启动";
    } else if (preview === "Internal Server Error") {
      hint =
        "后端 500：评估结果可能含无效浮点数（NaN），或 Custombackend 未部署最新 system-eval 路由；请重启 Custombackend 后重试";
    } else if (preview.includes("Not Found") || preview.includes('"detail":"Not Found"')) {
      hint =
        "Custombackend 无 /api/system-eval/track/evaluate（404），请部署含 system_eval_routes 的版本并重启";
    } else {
      hint = `响应不是合法 JSON（HTTP ${res.status}）: ${preview}`;
    }
    return {
      metrics: null,
      status: "error",
      error: hint,
      trackPointCount: 0,
      fetchedAt: new Date().toISOString(),
    };
  }
  const fetchedAt = json.timestamp ?? new Date().toISOString();

  if (!res.ok) {
    const parts = [json.message, json.error, json.detail].filter(Boolean);
    return {
      metrics: null,
      status: "error",
      error: parts.length > 0 ? parts.join(" · ") : `HTTP ${res.status}`,
      trackPointCount: 0,
      fetchedAt,
    };
  }

  const result = json.data?.result;
  const grpcErr = json.data?.error_message?.trim();
  if (!result) {
    return {
      metrics: null,
      status: "error",
      error: grpcErr || "无评估结果",
      trackPointCount: 0,
      fetchedAt,
    };
  }

  // proto3 JSON：status=0(OK) 时 MessageToDict 会省略该字段，不能当作失败
  const statusRaw = result.status;
  const status =
    statusRaw === undefined ||
    statusRaw === null ||
    statusRaw === 0 ||
    statusRaw === "OK" ||
    statusRaw === "EVALUATION_STATUS_OK"
      ? "OK"
      : typeof statusRaw === "string"
        ? statusRaw
        : String(statusRaw);

  const trackPointCount = Number(result.track_point_count ?? 0);
  const errMsg = (result.error_message as string | undefined)?.trim() || grpcErr || null;

  const statusLabels: Record<string, string> = {
    MISSING_AIS: "缺少 AIS 数据",
    MISSING_SELF_REPORT: "缺少自报位数据",
    MISSING_REFERENCE_DATA: "缺少参考数据",
    INVALID_TIME_RANGE: "时间范围无效",
    INTERNAL_ERROR: "服务端内部错误",
  };

  if (status !== "OK") {
    const friendly = statusLabels[status] ?? (status && status !== "undefined" ? status : null);
    return {
      metrics: null,
      status,
      error: errMsg || friendly || "航迹质量评估未完成",
      trackPointCount,
      fetchedAt,
    };
  }

  return {
    metrics: grpcResultToTrackEvalMetrics(result),
    status: "OK",
    error: errMsg,
    trackPointCount,
    fetchedAt,
  };
}
