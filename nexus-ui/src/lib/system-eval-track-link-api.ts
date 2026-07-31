/** 航迹链路评估 API（Custombackend 本地采集，不经 system-evaluation-server） */

export interface LinkSegmentStats {
  avg_ms: number;
  /** 中位数：对海融合「创建→接收」含观测时戳滞后时，比均值更稳健 */
  median_ms?: number;
  min_ms: number;
  max_ms: number;
  count: number;
}

export interface TrackLinkTypeResult {
  track_layer_key: string;
  label: string;
  sampled_track_count: number;
  /** 采集期见到的候选航迹数（含只出现 1 帧的） */
  candidate_track_count?: number;
  /** 因只出现 1 帧被丢弃的数量 */
  single_frame_dropped?: number;
  total_updates: number;
  /** 第 2 帧起计入的有效更新次数 */
  effective_updates?: number;
  update_frequency_hz: number;
  segments: {
    create_to_recv: LinkSegmentStats;
    recv_to_send: LinkSegmentStats;
    send_to_backend: LinkSegmentStats;
    total: LinkSegmentStats;
  };
}

export interface TrackLinkEvalData {
  task_id?: string;
  status?: "collecting" | "done" | "cancelled" | string;
  duration_sec?: number;
  elapsed_sec?: number;
  remaining_sec?: number;
  type_counts?: Record<
    string,
    { seen?: number; updated?: number; sampled: number; updates: number }
  >;
  results?: TrackLinkTypeResult[];
  error?: string | null;
  started_at?: number;
  ended_at?: number;
  max_tracks_per_type?: number;
}

export const TRACK_LINK_POLL_MS = 2000;

export const TRACK_LINK_SEGMENT_LABELS: {
  key: keyof TrackLinkTypeResult["segments"];
  label: string;
  hint?: string;
}[] = [
  {
    key: "create_to_recv",
    label: "创建 → 接收",
    hint: "报文创建时戳→源端接收；融合航迹可能含观测滞后（数十秒级），看中位数",
  },
  { key: "recv_to_send", label: "接收 → 发送", hint: "源端处理+组包" },
  { key: "send_to_backend", label: "发送 → 后端", hint: "gRPC 到 Custombackend" },
  { key: "total", label: "创建 → 后端（合计）" },
];

type ApiJson = {
  code?: number;
  message?: string;
  data?: TrackLinkEvalData;
  error?: string;
  detail?: string;
};

function formatHttpError(res: Response, raw: string, json: ApiJson | null): string {
  if (json) {
    const parts = [json.message, json.error, json.detail].filter(Boolean);
    if (parts.length > 0) return parts.join(" · ");
  }
  const preview = raw.trim().slice(0, 120);
  if (preview.startsWith("<!")) {
    return "接口返回了 HTML 而非 JSON，请确认 /api/system-eval/track-link 代理与 Custombackend 已就绪";
  }
  return preview ? `HTTP ${res.status}: ${preview}` : `HTTP ${res.status}`;
}

export async function triggerTrackLinkEval(opts?: {
  durationSec?: number;
  maxTracksPerType?: number;
}): Promise<{ taskId: string; durationSec: number; error: string | null; conflict?: boolean }> {
  const res = await fetch("/api/system-eval/track-link/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      duration_sec: opts?.durationSec ?? 30,
      max_tracks_per_type: opts?.maxTracksPerType ?? 10,
    }),
    cache: "no-store",
  });
  const raw = await res.text();
  let json: ApiJson | null = null;
  try {
    json = raw.trim() ? (JSON.parse(raw) as ApiJson) : null;
  } catch {
    return { taskId: "", durationSec: 30, error: formatHttpError(res, raw, null) };
  }

  if (res.status === 409) {
    const tid = json?.data?.task_id ?? "";
    return {
      taskId: tid,
      durationSec: Number(json?.data?.duration_sec ?? 30),
      error: json?.message || "已有评估在进行中",
      conflict: true,
    };
  }

  if (!res.ok || !json?.data?.task_id) {
    return { taskId: "", durationSec: 30, error: formatHttpError(res, raw, json) };
  }

  return {
    taskId: json.data.task_id,
    durationSec: Number(json.data.duration_sec ?? 30),
    error: null,
  };
}

export async function fetchTrackLinkResult(taskId?: string): Promise<{
  data: TrackLinkEvalData | null;
  error: string | null;
}> {
  const qs = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  const res = await fetch(`/api/system-eval/track-link/result${qs}`, {
    cache: "no-store",
  });
  const raw = await res.text();
  let json: ApiJson | null = null;
  try {
    json = raw.trim() ? (JSON.parse(raw) as ApiJson) : null;
  } catch {
    return { data: null, error: formatHttpError(res, raw, null) };
  }

  if (!res.ok || !json) {
    return { data: null, error: formatHttpError(res, raw, json) };
  }

  return { data: json.data ?? null, error: null };
}
