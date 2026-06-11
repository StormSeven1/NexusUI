import { create } from "zustand";
import { parseDetectionHeader } from "@/lib/eo-video/detectionSyncUtils";

/**
 * EO 检测框原始消息缓存。
 *
 * 设计目的：
 * - 主工程现在只保留一条 WebSocket 连接，由 `useUnifiedWsFeed` 统一接收所有实时消息
 * - 检测框消息 `MultiTrackResult / SingleTrackResult` 也从这条总线上进入
 * - 但 EO 视频同步逻辑仍然需要“按相机维度读取最近一小段检测框消息”
 * - 因此这里单独维护一个轻量 store，作为“主 WS -> EO 同步 hook”之间的中间缓存层
 *
 * 调用关系：
 * 1. `useUnifiedWsFeed`
 *    - 收到 `MultiTrackResult` / `SingleTrackResult`
 *    - 解析出 `cameraId / rects / syncHeader`
 *    - 调用 `pushDetectionEnvelope()`
 * 2. `useEoSyncedDetections`
 *    - 不再自己连接 WebSocket
 *    - 只从本 store 读取当前相机最近的检测框消息
 *    - 再结合 `encodedSyncHub` 做帧同步
 *
 * 为什么不直接把同步逻辑写进主 WS hook：
 * - 主 WS hook 的职责是“接收并分发”
 * - EO 视频同步的职责是“按当前相机和当前视频帧做局部匹配”
 * - 把二者拆开后，主链路更清晰，也避免 EO 逻辑污染全局消息处理
 */

export type EoDetectionMessageType = "MultiTrackResult" | "SingleTrackResult";

export interface EoDetectionEntry {
  type: EoDetectionMessageType;
  cameraId: string;
  header: Uint8Array | null;
  rects: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    boxId: number;
    classId: number | null;
  }>;
  receivedAt: number;
}

type DetectionEnvelope = {
  type?: string;
  data?: Record<string, unknown>;
};

interface EoDetectionState {
  entriesByCameraId: Record<string, EoDetectionEntry[]>;
  pushDetectionEnvelope: (envelope: DetectionEnvelope) => void;
  clearCameraEntries: (cameraId: string) => void;
  clearAll: () => void;
}

const PER_CAMERA_CAP = 200;

export function canonicalDetectionCameraId(value: string): string {
  return value.trim();
}

function cameraIdFromEnvelope(envelope: DetectionEnvelope): string {
  const raw = envelope.data?.cameraId;
  return raw == null ? "" : canonicalDetectionCameraId(String(raw));
}

function rectsFromEnvelope(envelope: DetectionEnvelope): EoDetectionEntry["rects"] | null {
  const payload = envelope.data;
  if (!payload) return null;
  if (envelope.type === "MultiTrackResult") {
    const boxes = payload.boxes;
    if (!Array.isArray(boxes)) return [];
    return boxes.flatMap((item) => {
      if (typeof item !== "object" || item == null) return [];
      const row = item as Record<string, unknown>;
      const x = Number(row.x);
      const y = Number(row.y);
      const width = Number(row.width ?? row.w);
      const height = Number(row.height ?? row.h);
      const boxId = Number(row.boxId ?? row.box_id);
      const classId = Number(row.classId ?? row.class_id);
      if (![x, y, width, height].every(Number.isFinite)) return [];
      return [{
        x,
        y,
        width,
        height,
        boxId: Number.isFinite(boxId) ? boxId : 0,
        classId: Number.isFinite(classId) ? classId : null,
      }];
    });
  }
  if (envelope.type === "SingleTrackResult") {
    const box = payload.box;
    if (typeof box !== "object" || box == null) return [];
    const row = box as Record<string, unknown>;
    const x = Number(row.x);
    const y = Number(row.y);
    const width = Number(row.width ?? row.w);
    const height = Number(row.height ?? row.h);
    const boxId = Number(row.boxId ?? row.box_id);
    const classId = Number(row.classId ?? row.class_id);
    if (![x, y, width, height].every(Number.isFinite)) return [];
    return [{
      x,
      y,
      width,
      height,
      boxId: Number.isFinite(boxId) ? boxId : 0,
      classId: Number.isFinite(classId) ? classId : null,
    }];
  }
  return null;
}

export const useEoDetectionStore = create<EoDetectionState>((set) => ({
  entriesByCameraId: {},

  pushDetectionEnvelope: (envelope) =>
    set((state) => {
      const type =
        envelope.type === "MultiTrackResult" || envelope.type === "SingleTrackResult"
          ? envelope.type
          : null;
      if (!type) return state;
      const cameraId = cameraIdFromEnvelope(envelope);
      if (!cameraId) return state;
      const rects = rectsFromEnvelope(envelope);
      if (!rects || rects.length === 0) return state;
      const entry: EoDetectionEntry = {
        type,
        cameraId,
        header: parseDetectionHeader(envelope.data?.syncHeader ?? envelope.data?.sync_header ?? null),
        rects,
        receivedAt: Date.now(),
      };
      const prev = state.entriesByCameraId[cameraId] ?? [];
      const next = [...prev, entry];
      while (next.length > PER_CAMERA_CAP) next.shift();
      return {
        entriesByCameraId: {
          ...state.entriesByCameraId,
          [cameraId]: next,
        },
      };
    }),

  clearCameraEntries: (cameraId) =>
    set((state) => {
      const next = { ...state.entriesByCameraId };
      delete next[canonicalDetectionCameraId(cameraId)];
      return { entriesByCameraId: next };
    }),

  clearAll: () => set({ entriesByCameraId: {} }),
}));
