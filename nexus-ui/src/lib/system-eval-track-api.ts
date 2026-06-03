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

export async function fetchTrackEvalQuality(
  body: TrackEvalGrpcRequest,
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
    }),
    cache: "no-store",
  });

  const json = (await res.json()) as TrackEvalGrpcApiResponse & { error?: string; detail?: string };
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

  const statusRaw = result.status;
  const status =
    statusRaw === 0 || statusRaw === "OK"
      ? "OK"
      : typeof statusRaw === "string"
        ? statusRaw
        : String(statusRaw);

  const trackPointCount = Number(result.track_point_count ?? 0);
  const errMsg = (result.error_message as string | undefined)?.trim() || grpcErr || null;

  if (status !== "OK" && status !== "0") {
    return {
      metrics: null,
      status,
      error: errMsg || status,
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
