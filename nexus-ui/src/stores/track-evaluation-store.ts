"use client";

import { create } from "zustand";
import {
  TrackEvaluationWsClient,
  getTrackEvalWsUrl,
  type TrackEvalConnectionState,
  type TrackEvalInboundMessage,
  type TrackEvalQueryPayload,
} from "@/lib/track-evaluation-ws";
import {
  computeAllTrackMetrics,
  resolveTrackEvalRadarChannelsFromAssets,
  wsTrackRowToFeature,
  type EvalTrackFeature,
  type TrackEvalMetricsResult,
} from "@/lib/track-evaluation-metrics";
import { useAssetStore } from "@/stores/asset-store";
import type { TrackEvalRegionKind } from "@/components/map/modules/track-eval-region-draw-maplibre";
import type {
  TrackEvalBoundingBox,
  TrackEvalPolygonQuery,
  TrackEvalRegionResult,
} from "@/components/map/modules/track-eval-region-draw-maplibre";
import { getTrackEvalMapHandlers } from "@/lib/track-eval-map-bridge";
import { getMapMeasureHandlers } from "@/stores/map-measure-bridge";
import { useMapMeasureUi } from "@/stores/map-measure-bridge";

export type QueryStatusType = "" | "loading" | "success" | "error" | "info";

export interface QueryStatus {
  type: QueryStatusType;
  message: string;
  details: string;
}

export interface QueryStats {
  total: number;
  bySensor: Record<string, number>;
}

export const TRACK_EVAL_SENSOR_OPTIONS = [
  { id: 0, label: "对海融合航迹" },
  { id: 1, label: "远遥码头雷达" },
  { id: 2, label: "靖子头雷达" },
  { id: 3, label: "AIS" },
  { id: 5, label: "探鸟雷达" },
  { id: 4, label: "自报位" },
  { id: 6, label: "对空融合航迹" },
  { id: 7, label: "KU雷达" },
] as const;

/** 默认勾选：对海融合、码头雷达、AIS、探鸟、自报位、对空融合 */
export const DEFAULT_TRACK_EVAL_SENSOR_IDS = [0, 1, 3, 4, 5, 6] as const;

export const TRACK_EVAL_AUTO_QUERY_INTERVAL_MS = 3 * 60 * 1000;
/** 定时查询时间窗：最近 3 分钟 */
export const TRACK_EVAL_SCHEDULED_QUERY_WINDOW_MINUTES = 3;

export const QUALITY_METRIC_TABS = [
  { id: "accuracy", label: "准确率" },
  { id: "recall", label: "召回率" },
  { id: "falseAlarm", label: "虚警率" },
  { id: "stability", label: "跟踪稳定性-航迹点" },
  { id: "stabilityDuration", label: "跟踪稳定性-时长" },
  { id: "maxTrackingDuration", label: "最大跟踪时长" },
  { id: "breakCount", label: "航迹断批次数" },
  { id: "changeBatchCount", label: "航迹换批次数" },
  { id: "distanceHeightError", label: "距离高度误差" },
  { id: "azimuthError", label: "方位角误差" },
  { id: "elevationError", label: "俯仰角误差" },
  { id: "courseError", label: "航向误差" },
  { id: "speedError", label: "航速误差" },
] as const;

export type QualityMetricTabId = (typeof QUALITY_METRIC_TABS)[number]["id"];

interface TrackEvaluationState {
  wsUrl: string;
  connectionState: TrackEvalConnectionState;
  client: TrackEvaluationWsClient | null;

  mainTab: "filter" | "quality";
  qualityTab: QualityMetricTabId;

  startTime: string;
  endTime: string;
  sensorIdsForQuery: number[];
  directDownload: boolean;
  realtimeTracking: boolean;
  queryStatus: QueryStatus;
  queryStats: QueryStats;

  regionType: TrackEvalRegionKind;
  regionInfo: string;
  regionDrawing: "rect" | "polygon" | null;
  bounding_box: TrackEvalBoundingBox | null;
  polygon: TrackEvalPolygonQuery | null;

  /** 查询累积航迹点（不绘制到地图，仅用于指标计算） */
  queryFeatures: EvalTrackFeature[];
  metrics: TrackEvalMetricsResult | null;
  metricsComputing: boolean;

  lastInboundPreview: string;

  setMainTab: (tab: "filter" | "quality") => void;
  setQualityTab: (tab: QualityMetricTabId) => void;
  setStartTime: (v: string) => void;
  setEndTime: (v: string) => void;
  toggleSensorForQuery: (id: number) => void;
  setDirectDownload: (v: boolean) => void;
  selectRegionType: (type: "rect" | "polygon") => void;
  clearRegion: () => void;
  applyRegionResult: (r: TrackEvalRegionResult) => void;
  onRegionDrawCancel: () => void;
  connectWs: () => void;
  disconnectWs: () => void;
  sendQuery: () => void;
  /** 定时任务：刷新近 1 小时时间窗、恢复默认传感器并发送查询 */
  runScheduledQuery: () => void;
  cancelQuery: () => void;
  toggleRealtime: () => void;
  requestReevaluate: () => void;
  computeMetricsFromBuffer: () => void;
}

function defaultDatetimeLocal(offsetHours: number): string {
  return defaultDatetimeLocalFromMinutes(offsetHours * 60);
}

function defaultDatetimeLocalFromMinutes(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTimeForQuery(datetimeLocal: string): string {
  if (!datetimeLocal) return "";
  const d = new Date(datetimeLocal);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function emptyMetricsState(): Pick<TrackEvaluationState, "queryFeatures" | "metrics"> {
  return { queryFeatures: [], metrics: null };
}

function runMetrics(set: (p: Partial<TrackEvaluationState>) => void, get: () => TrackEvaluationState) {
  const features = get().queryFeatures;
  if (features.length === 0) {
    set({ metrics: null, metricsComputing: false });
    return;
  }
  set({ metricsComputing: true });
  queueMicrotask(() => {
    try {
      const radarChannels = resolveTrackEvalRadarChannelsFromAssets(
        useAssetStore.getState().assets,
      );
      const metrics = computeAllTrackMetrics(features, radarChannels);
      set({
        metrics,
        metricsComputing: false,
        mainTab: "quality",
        queryStatus: {
          type: "success",
          message: "质量指标计算完成",
          details: `共 ${features.length} 条航迹点`,
        },
      });
    } catch (e) {
      console.error("[track-evaluation] metrics failed", e);
      set({
        metricsComputing: false,
        queryStatus: {
          type: "error",
          message: "指标计算失败",
          details: e instanceof Error ? e.message : String(e),
        },
      });
    }
  });
}

function handleInbound(
  set: (p: Partial<TrackEvaluationState> | ((s: TrackEvaluationState) => Partial<TrackEvaluationState>)) => void,
  get: () => TrackEvaluationState,
  msg: TrackEvalInboundMessage,
) {
  if (msg.type === "ping" || (msg.status === "success" && !msg.data && !msg.message)) {
    return;
  }

  const preview = msg.message ?? msg.status ?? msg.type ?? "message";
  set({ lastInboundPreview: String(preview).slice(0, 120) });

  if (msg.status === "segment") {
    set((s) => ({
      queryStatus: {
        type: "loading",
        message: msg.message ?? "正在检索时间段",
        details: msg.segment_start_time && msg.segment_end_time
          ? `${msg.segment_start_time} ~ ${msg.segment_end_time}`
          : s.queryStatus.details,
      },
    }));
    return;
  }

  if (msg.status === "data" && Array.isArray(msg.data)) {
    const rows = msg.data as Record<string, unknown>[];
    const newFeatures = rows.map(wsTrackRowToFeature);
    set((s) => {
      const bySensor = { ...s.queryStats.bySensor };
      for (const f of newFeatures) {
        const sid = String(f.sensorId);
        bySensor[sid] = (bySensor[sid] ?? 0) + 1;
      }
      const total = s.queryStats.total + newFeatures.length;
      return {
        queryFeatures: [...s.queryFeatures, ...newFeatures],
        queryStats: { total, bySensor },
        queryStatus: {
          type: "loading",
          message: `接收数据中… 已累计 ${total} 条`,
          details:
            msg.batch_index != null && msg.batch_count != null
              ? `批次 ${msg.batch_index}/${msg.batch_count}`
              : s.queryStatus.details,
        },
      };
    });
    return;
  }

  if (msg.status === "complete") {
    set((s) => ({
      queryStatus: {
        type: "loading",
        message: "查询完成，正在计算质量指标…",
        details: msg.total_count != null ? `共 ${msg.total_count} 条` : s.queryStatus.details,
      },
    }));
    runMetrics(set, get);
    return;
  }

  if (msg.status === "error") {
    set({
      queryStatus: {
        type: "error",
        message: msg.message ?? "查询失败",
        details: "",
      },
      metricsComputing: false,
    });
    return;
  }

  if (msg.status === "realtime" && Array.isArray(msg.data)) {
    const rows = msg.data as Record<string, unknown>[];
    const newFeatures = rows.map(wsTrackRowToFeature);
    set((s) => {
      const features = [...s.queryFeatures, ...newFeatures];
      return {
        queryFeatures: features,
        queryStats: { total: features.length, bySensor: countBySensor(features) },
        queryStatus: {
          type: "success",
          message: "实时航迹更新",
          details: `${rows.length} 条（累计 ${features.length}）`,
        },
      };
    });
  }
}

function countBySensor(features: EvalTrackFeature[]): Record<string, number> {
  const bySensor: Record<string, number> = {};
  for (const f of features) {
    const sid = String(f.sensorId);
    bySensor[sid] = (bySensor[sid] ?? 0) + 1;
  }
  return bySensor;
}

let sharedClient: TrackEvaluationWsClient | null = null;

export const useTrackEvaluationStore = create<TrackEvaluationState>((set, get) => ({
  wsUrl: getTrackEvalWsUrl(),
  connectionState: "idle",
  client: null,

  mainTab: "filter",
  qualityTab: "accuracy",

  startTime: defaultDatetimeLocal(-1),
  endTime: defaultDatetimeLocal(0),
  sensorIdsForQuery: [...DEFAULT_TRACK_EVAL_SENSOR_IDS],
  directDownload: false,
  realtimeTracking: false,
  queryStatus: { type: "", message: "", details: "" },
  queryStats: { total: 0, bySensor: {} },

  regionType: "",
  regionInfo: "",
  regionDrawing: null,
  bounding_box: null,
  polygon: null,

  queryFeatures: [],
  metrics: null,
  metricsComputing: false,

  lastInboundPreview: "",

  setMainTab: (tab) => set({ mainTab: tab }),
  setQualityTab: (tab) => set({ qualityTab: tab }),
  setStartTime: (v) => set({ startTime: v }),
  setEndTime: (v) => set({ endTime: v }),
  setDirectDownload: (v) => set({ directDownload: v }),
  toggleSensorForQuery: (id) =>
    set((s) => {
      const has = s.sensorIdsForQuery.includes(id);
      return {
        sensorIdsForQuery: has
          ? s.sensorIdsForQuery.filter((x) => x !== id)
          : [...s.sensorIdsForQuery, id].sort((a, b) => a - b),
      };
    }),

  selectRegionType: (type) => {
    const s = get();
    if (s.regionDrawing === type) {
      getTrackEvalMapHandlers()?.cancelRegionDraw();
      set({ regionDrawing: null, regionType: "", regionInfo: "" });
      return;
    }
    getMapMeasureHandlers()?.setDrawTool(null);
    useMapMeasureUi.getState().setActiveDrawTool(null);
    getTrackEvalMapHandlers()?.clearRegion();
    set({
      regionDrawing: type,
      regionType: type,
      regionInfo:
        type === "rect"
          ? "在地图上按住左键拖拽绘制矩形，松开完成；右键取消"
          : "左键添加顶点，双击或右键完成多边形；右键取消",
      bounding_box: null,
      polygon: null,
    });
    getTrackEvalMapHandlers()?.startRegionDraw(type);
  },

  clearRegion: () => {
    getTrackEvalMapHandlers()?.clearRegion();
    set({
      regionType: "",
      regionInfo: "",
      regionDrawing: null,
      bounding_box: null,
      polygon: null,
    });
  },

  applyRegionResult: (r) => {
    set({
      regionType: r.kind,
      regionInfo: r.regionInfo,
      regionDrawing: null,
      bounding_box: r.bounding_box ?? null,
      polygon: r.polygon ?? null,
    });
  },

  onRegionDrawCancel: () => {
    set({ regionDrawing: null });
  },

  connectWs: () => {
    if (sharedClient) {
      sharedClient.connect();
      set({ client: sharedClient });
      return;
    }
    const url = get().wsUrl;
    const client = new TrackEvaluationWsClient(url, {
      onState: (connectionState) => set({ connectionState }),
      onMessage: (msg) => handleInbound(set, get, msg),
    });
    sharedClient = client;
    client.connect();
    set({ client });
  },

  disconnectWs: () => {
    sharedClient?.disconnect();
    sharedClient = null;
    set({ client: null, connectionState: "closed" });
  },

  runScheduledQuery: () => {
    const s = get();
    if (s.realtimeTracking) return;
    if (s.queryStatus.type === "loading" || s.metricsComputing) return;
    if (s.directDownload) return;

    const windowMin = TRACK_EVAL_SCHEDULED_QUERY_WINDOW_MINUTES;
    set({
      startTime: defaultDatetimeLocalFromMinutes(-windowMin),
      endTime: defaultDatetimeLocalFromMinutes(0),
      sensorIdsForQuery: [...DEFAULT_TRACK_EVAL_SENSOR_IDS],
    });
    get().sendQuery();
  },

  sendQuery: () => {
    const s = get();
    const client = s.client ?? sharedClient;
    if (!client?.isOpen) {
      set({
        queryStatus: { type: "error", message: "WebSocket 未连接", details: s.wsUrl },
      });
      return;
    }
    const payload: TrackEvalQueryPayload = {
      type: s.directDownload ? "download" : "query",
      start_time: formatTimeForQuery(s.startTime),
      end_time: formatTimeForQuery(s.endTime),
      region_type: s.regionType || "",
      batch_size: 50_000,
      sensor_id:
        s.sensorIdsForQuery.length > 0
          ? s.sensorIdsForQuery
          : [...DEFAULT_TRACK_EVAL_SENSOR_IDS],
    };
    if (s.regionType === "rect" && s.bounding_box) {
      payload.bounding_box = s.bounding_box;
    } else if (s.regionType === "polygon" && s.polygon) {
      payload.polygon = s.polygon;
    }
    set({
      ...emptyMetricsState(),
      queryStats: { total: 0, bySensor: {} },
      queryStatus: {
        type: "loading",
        message: s.directDownload ? "正在发送下载请求…" : "正在发送查询请求…",
        details: s.regionInfo || "",
      },
      metricsComputing: false,
    });
    if (!client.send(payload)) {
      set({ queryStatus: { type: "error", message: "发送失败", details: "" } });
    }
  },

  cancelQuery: () => {
    const client = get().client ?? sharedClient;
    if (!client?.send({ type: "cancel" })) {
      set({ queryStatus: { type: "error", message: "无法取消：未连接", details: "" } });
      return;
    }
    set({
      queryStatus: { type: "info", message: "查询已取消", details: "" },
      queryStats: { total: 0, bySensor: {} },
      ...emptyMetricsState(),
      metricsComputing: false,
    });
  },

  toggleRealtime: () => {
    const s = get();
    const client = s.client ?? sharedClient;
    if (!client?.isOpen) {
      set({ queryStatus: { type: "error", message: "WebSocket 未连接", details: "" } });
      return;
    }
    if (s.realtimeTracking) {
      client.send({ type: "stopsend" });
      set({
        realtimeTracking: false,
        queryStatus: { type: "info", message: "实时航迹已停止，正在计算指标…", details: "" },
      });
      runMetrics(set, get);
    } else {
      client.send({ type: "startsend" });
      set({
        realtimeTracking: true,
        ...emptyMetricsState(),
        queryStats: { total: 0, bySensor: {} },
        queryStatus: { type: "success", message: "实时航迹已启动", details: "约每 2 秒推送并刷新指标" },
      });
    }
  },

  requestReevaluate: () => {
    set({
      queryStatus: { type: "info", message: "正在重新计算质量指标…", details: "" },
    });
    runMetrics(set, get);
  },

  computeMetricsFromBuffer: () => runMetrics(set, get),
}));
