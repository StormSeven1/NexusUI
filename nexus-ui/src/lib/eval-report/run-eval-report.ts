import {
  fetchSystemPerfStats,
  type SystemResponseTimeStats,
} from "@/lib/system-eval-perf-api";
import {
  fetchTrackEvalQuality,
  isTrackEvalGrpcEnabled,
} from "@/lib/system-eval-track-api";
import {
  fetchTrackLinkResult,
  triggerTrackLinkEval,
  type TrackLinkTypeResult,
} from "@/lib/system-eval-track-link-api";
import {
  DEFAULT_TRACK_EVAL_SENSOR_IDS,
  TRACK_EVAL_SENSOR_OPTIONS,
  useTrackEvaluationStore,
} from "@/stores/track-evaluation-store";
import type { TrackEvalMetricsResult } from "@/lib/track-evaluation-metrics";
import {
  assembleReportDocument,
  buildCameraEvalPlaceholderSection,
  buildSystemPerfSection,
  buildTrackEvalSection,
} from "@/lib/eval-report/build-report-document";
import type {
  EvalReportSectionKind,
  ReportDocument,
  ReportSection,
} from "@/lib/eval-report/types";
import {
  buildDisplayFilterGrpcPayload,
  enrichSensorsForDisplayIdFilters,
  filterGrpcTrackMetrics,
} from "@/lib/track-evaluation-display-filter";

export type CachedSystemForReport = {
  stats: SystemResponseTimeStats | null;
  error: string | null;
  fetchedAt: string;
  trackLinkResults?: TrackLinkTypeResult[] | null;
  trackLinkError?: string | null;
  trackLinkDurationSec?: number | null;
};

function formatTimeForQuery(datetimeLocal: string): string {
  if (!datetimeLocal) return "";
  const d = new Date(datetimeLocal);
  if (Number.isNaN(d.getTime())) return datetimeLocal;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 报告生成时限制查询窗口，降低 DEADLINE_EXCEEDED 概率（与前端默认半小时窗对齐） */
const REPORT_TRACK_EVAL_MAX_WINDOW_MS = 30 * 60 * 1000;

function resolveReportTrackTimeRange(startLocal: string, endLocal: string): {
  startFmt: string;
  endFmt: string;
  clipped: boolean;
} {
  const endMs = Date.parse(endLocal);
  const startMs = Date.parse(startLocal);
  if (Number.isNaN(endMs) || Number.isNaN(startMs)) {
    return {
      startFmt: formatTimeForQuery(startLocal),
      endFmt: formatTimeForQuery(endLocal),
      clipped: false,
    };
  }
  let s = startMs;
  let e = endMs;
  if (e < s) {
    const t = s;
    s = e;
    e = t;
  }
  let clipped = false;
  if (e - s > REPORT_TRACK_EVAL_MAX_WINDOW_MS) {
    s = e - REPORT_TRACK_EVAL_MAX_WINDOW_MS;
    clipped = true;
  }
  const toLocal = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return {
    startFmt: formatTimeForQuery(toLocal(s)),
    endFmt: formatTimeForQuery(toLocal(e)),
    clipped,
  };
}

function sensorLabels(ids: number[]): string[] {
  return ids.map(
    (id) => TRACK_EVAL_SENSOR_OPTIONS.find((o) => o.id === id)?.label ?? `传感器 ${id}`,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

/** 触发并等待航迹链路评估完成（约 30s） */
async function collectTrackLinkForReport(
  onProgress?: EvalReportProgressCallback,
  preferredDurationSec = 30,
  signal?: AbortSignal,
): Promise<{
  results: TrackLinkTypeResult[] | null;
  error: string | null;
  durationSec: number | null;
}> {
  throwIfAborted(signal);
  onProgress?.({ phase: "system", message: "正在启动航迹链路评估…" });
  const trigger = await triggerTrackLinkEval({
    durationSec: preferredDurationSec,
    maxTracksPerType: 10,
    signal,
  });
  if (trigger.error && !trigger.conflict) {
    return { results: null, error: trigger.error, durationSec: null };
  }
  const tid = trigger.taskId;
  if (!tid) {
    return { results: null, error: "航迹链路评估未返回 task_id", durationSec: null };
  }
  const durationSec = trigger.durationSec || preferredDurationSec;
  const deadline = Date.now() + (durationSec + 20) * 1000;

  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const r = await fetchTrackLinkResult(tid, { signal });
    if (r.error) {
      return { results: null, error: r.error, durationSec };
    }
    const data = r.data;
    if (!data) {
      await sleep(2000, signal);
      continue;
    }
    if (data.status === "collecting") {
      const rem = Math.ceil(Number(data.remaining_sec ?? 0));
      onProgress?.({
        phase: "system",
        message: `航迹链路采集中…剩余约 ${rem}s`,
      });
      await sleep(2000, signal);
      continue;
    }
    if (data.status === "done" || data.status === "cancelled") {
      const results = data.results ?? [];
      const emptyHint =
        data.message?.trim() ||
        (results.length === 0
          ? "未采到航迹：请确认 Custombackend 有进站航迹（gRPC/融合）且采集期内有≥2帧更新"
          : null);
      return {
        results,
        error: data.error?.trim() || emptyHint,
        durationSec: Number(data.duration_sec ?? durationSec),
      };
    }
    await sleep(2000, signal);
  }
  return { results: null, error: "航迹链路评估超时", durationSec };
}

async function waitForTrackWsResult(timeoutMs = 180_000): Promise<{
  metrics: TrackEvalMetricsResult | null;
  error: string | null;
  trackPointCount: number;
}> {
  const store = useTrackEvaluationStore.getState();
  store.connectWs();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const s = useTrackEvaluationStore.getState();
    if (s.connectionState === "open" || s.client?.isOpen) break;
    await sleep(200);
  }

  const afterConnect = useTrackEvaluationStore.getState();
  if (!afterConnect.client?.isOpen && afterConnect.connectionState !== "open") {
    return {
      metrics: null,
      error: `航迹评估 WebSocket 未连接（${afterConnect.wsUrl}）`,
      trackPointCount: 0,
    };
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      unsub();
      resolve({
        metrics: null,
        error: "航迹评估超时",
        trackPointCount: 0,
      });
    }, timeoutMs);

    const unsub = useTrackEvaluationStore.subscribe((s) => {
      if (s.metricsComputing || s.queryStatus.type === "loading") return;
      if (s.queryStatus.type === "success" && s.metrics) {
        window.clearTimeout(timeout);
        unsub();
        resolve({
          metrics: s.metrics,
          error: null,
          trackPointCount: s.queryStats.total,
        });
        return;
      }
      if (s.queryStatus.type === "error") {
        window.clearTimeout(timeout);
        unsub();
        resolve({
          metrics: s.metrics,
          error: s.queryStatus.message || "航迹评估失败",
          trackPointCount: s.queryStats.total,
        });
      }
    });

    useTrackEvaluationStore.getState().sendQuery();
  });
}

export type EvalReportProgressCallback = (info: {
  phase: "system" | "track" | "camera" | "assembling";
  message: string;
}) => void;

export interface RunEvalReportOptions {
  /** 勾选的评估类型；至少一项 */
  kinds: EvalReportSectionKind[];
  /**
   * 为 true 时：航迹章节直接使用 `useTrackEvaluationStore.metrics`，不重新 gRPC/WS 评估。
   * 若同时提供 `cachedSystem`，系统章节也不重新拉取。
   */
  reuseExistingResults?: boolean;
  /** 系统评估页当前结果快照（reuse 时优先使用） */
  cachedSystem?: CachedSystemForReport | null;
  /** 停止生成时 abort */
  signal?: AbortSignal;
}

/**
 * 按勾选类型执行评估并组装 ReportDocument（未勾选的章节不写入）。
 * 系统评估（含航迹链路采集）与航迹质量评估相互独立，可并行。
 */
export async function runEvalReportGeneration(
  onProgress?: EvalReportProgressCallback,
  options?: RunEvalReportOptions,
): Promise<ReportDocument> {
  const kindSet = new Set(
    (options?.kinds?.length ? options.kinds : ["system", "track", "camera"]) as EvalReportSectionKind[],
  );
  if (kindSet.size === 0) {
    throw new Error("请至少勾选一种评估类型");
  }
  const reuse = options?.reuseExistingResults === true;
  const signal = options?.signal;

  const trackState = useTrackEvaluationStore.getState();
  const displayGrpc = buildDisplayFilterGrpcPayload(trackState.displayFilter);
  const baseSensorIds =
    trackState.sensorIdsForQuery.length > 0
      ? [...trackState.sensorIdsForQuery]
      : [...DEFAULT_TRACK_EVAL_SENSOR_IDS];
  const sensorIds = enrichSensorsForDisplayIdFilters(baseSensorIds, displayGrpc);
  const trackTime = resolveReportTrackTimeRange(trackState.startTime, trackState.endTime);
  const startFmt = trackTime.startFmt;
  const endFmt = trackTime.endFmt;
  const labels = sensorLabels(sensorIds);

  const needSystem = kindSet.has("system");
  const needTrack = kindSet.has("track");
  const needCamera = kindSet.has("camera");

  if (needSystem && needTrack) {
    onProgress?.({
      phase: "system",
      message: "并行执行：系统/航迹链路评估 + 航迹质量评估…",
    });
  }

  const runSystem = async (): Promise<ReportSection | null> => {
    if (!needSystem) return null;

    let trackLinkResults: TrackLinkTypeResult[] | null =
      options?.cachedSystem?.trackLinkResults ?? null;
    let trackLinkError: string | null = options?.cachedSystem?.trackLinkError ?? null;
    let trackLinkDurationSec: number | null =
      options?.cachedSystem?.trackLinkDurationSec ?? null;

    let systemStats: SystemResponseTimeStats | null = null;
    let systemError: string | null = null;
    let systemFetchedAt: string | undefined;

    const linkProgress: EvalReportProgressCallback | undefined = needTrack
      ? (info) =>
          onProgress?.({
            phase: info.phase,
            message: `【链路】${info.message}`,
          })
      : onProgress;

    const fetchAlarmStats = async () => {
      if (reuse && options?.cachedSystem) {
        if (!needTrack) {
          onProgress?.({ phase: "system", message: "使用当前系统评估结果…" });
        }
        return {
          stats: options.cachedSystem.stats,
          error: options.cachedSystem.error,
          fetchedAt: options.cachedSystem.fetchedAt as string | undefined,
        };
      }
      if (!needTrack) {
        onProgress?.({ phase: "system", message: "正在执行系统评估…" });
      }
      const systemResult = await fetchSystemPerfStats(10, { signal });
      return {
        stats: systemResult.stats,
        error: systemResult.error,
        fetchedAt: systemResult.fetchedAt as string | undefined,
      };
    };

    const fetchTrackLink = async () => {
      if (trackLinkResults != null) {
        if (!needTrack) {
          onProgress?.({ phase: "system", message: "使用当前航迹链路评估结果…" });
        }
        return {
          results: trackLinkResults,
          error: trackLinkError,
          durationSec: trackLinkDurationSec,
        };
      }
      return collectTrackLinkForReport(linkProgress, 30, signal);
    };

    // 告警耗时拉取与航迹链路采集也并行
    const [alarm, link] = await Promise.all([fetchAlarmStats(), fetchTrackLink()]);
    systemStats = alarm.stats;
    systemError = alarm.error;
    systemFetchedAt = alarm.fetchedAt;
    trackLinkResults = link.results ?? [];
    trackLinkError = link.error;
    trackLinkDurationSec = link.durationSec;

    return buildSystemPerfSection({
      stats: systemStats,
      error: systemError,
      fetchedAt: systemFetchedAt,
      trackLinkResults,
      trackLinkError,
      trackLinkDurationSec,
    });
  };

  const runTrack = async (): Promise<ReportSection | null> => {
    if (!needTrack) return null;

    let trackMetrics: TrackEvalMetricsResult | null = null;
    let trackError: string | null = null;
    let trackPointCount = 0;

    if (reuse) {
      if (!needSystem) {
        onProgress?.({ phase: "track", message: "使用当前航迹质量评估结果…" });
      } else {
        onProgress?.({ phase: "track", message: "【航迹】使用当前质量评估结果…" });
      }
      trackMetrics = trackState.metrics;
      trackPointCount = trackState.queryStats.total;
      if (!trackMetrics) {
        trackError = "当前没有航迹质量评估结果，请先在「质量评估」中完成评估";
      }
    } else {
      onProgress?.({
        phase: "track",
        message: needSystem
          ? trackTime.clipped
            ? "【航迹】正在执行航迹质量评估（报告窗口已限制为最近 30 分钟）…"
            : "【航迹】正在执行航迹质量评估…"
          : trackTime.clipped
            ? "正在执行航迹评估（报告窗口已限制为最近 30 分钟）…"
            : "正在执行航迹评估（当前勾选）…",
      });

      if (isTrackEvalGrpcEnabled() && !trackState.directDownload) {
        try {
          throwIfAborted(signal);
          const r = await fetchTrackEvalQuality(
            {
              start_time: startFmt,
              end_time: endFmt,
              sensor_ids: sensorIds,
              region_type: (trackState.regionType as "" | "rect" | "polygon") || "",
              bounding_box: trackState.bounding_box ?? undefined,
              polygon: trackState.polygon ?? undefined,
              ...displayGrpc,
            },
            { signal },
          );
          trackMetrics = r.metrics
            ? filterGrpcTrackMetrics(r.metrics, trackState.displayFilter)
            : null;
          trackPointCount = r.trackPointCount;
          if (!r.metrics || r.status !== "OK") {
            trackError = r.error?.trim() || "gRPC 航迹评估失败";
          } else {
            useTrackEvaluationStore.setState({
              metrics: trackMetrics,
              unfilteredGrpcMetrics: r.metrics,
              metricsComputing: false,
              mainTab: "quality",
              queryStats: { total: r.trackPointCount, bySensor: {} },
              queryStatus: {
                type: "success",
                message: "质量指标计算完成（报告生成）",
                details: `共 ${r.trackPointCount} 条航迹点参与计算`,
              },
            });
          }
        } catch (e) {
          if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
            throw e instanceof Error ? e : new DOMException("Aborted", "AbortError");
          }
          trackError = e instanceof Error ? e.message : String(e);
        }
      } else if (trackState.directDownload) {
        trackError = "当前为「直接下载」模式，报告生成请先取消直接下载并使用质量评估查询";
      } else {
        const r = await waitForTrackWsResult();
        trackMetrics = r.metrics;
        trackError = r.error;
        trackPointCount = r.trackPointCount;
      }
    }

    return buildTrackEvalSection({
      metrics: trackMetrics,
      error: trackError,
      trackPointCount,
      startTime: startFmt,
      endTime: endFmt,
      sensorLabels: labels,
    });
  };

  const [systemSection, trackSection] = await Promise.all([runSystem(), runTrack()]);

  let cameraSection: ReportSection | null = null;
  if (needCamera) {
    throwIfAborted(signal);
    onProgress?.({ phase: "camera", message: "光电评估占位…" });
    await sleep(80, signal);
    cameraSection = buildCameraEvalPlaceholderSection();
  }

  throwIfAborted(signal);
  onProgress?.({ phase: "assembling", message: "正在组装评估报告…" });
  return assembleReportDocument({
    system: systemSection,
    track: trackSection,
    camera: cameraSection,
    meta: {
      timeRange: kindSet.has("track") ? { start: startFmt, end: endFmt } : undefined,
      trackSensorIds: kindSet.has("track") ? sensorIds : undefined,
      trackSensorLabels: kindSet.has("track") ? labels : undefined,
      selectedKinds: [...kindSet],
      notes: reuse
        ? [
            "本报告根据质量评估页当前结果组装，未重新执行评估。",
            ...(kindSet.has("track")
              ? ["航迹章节：使用当前航迹质量指标。"]
              : []),
            ...(kindSet.has("system") && options?.cachedSystem
              ? ["系统章节：使用当前系统响应耗时快照。"]
              : []),
          ]
        : undefined,
    },
  });
}
