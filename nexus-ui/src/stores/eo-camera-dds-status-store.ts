import { create } from "zustand";
import { canonicalEntityId } from "@/lib/camera-entity-id";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 根载荷与常见嵌套对象（track / target 等）上逐层取第一个有定义的字段 */
function pickFromCameraPayload(d: Record<string, unknown>, keys: string[]): unknown {
  const nested = [
    d,
    asRecord(d.track),
    asRecord(d.target),
    asRecord(d.trackedTarget),
    asRecord(d.trackInfo),
    asRecord(d.opto),
    asRecord(d.camera),
  ].filter((x): x is Record<string, unknown> => Boolean(x));
  for (const layer of nested) {
    for (const k of keys) {
      const v = layer[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}

/**
 * DDS → Custombackend → WS `Camera` 消息的任务字段旁路缓存。
 *
 * `useUnifiedWsFeed` 里地图显隐会 `filterAssetsForDisplay` 剔除 EXCLUDE_CAMERA_IDS，
 * 被拉黑的相机不会进入 asset-store，但光电页仍需显示 taskType / executionState 等。
 * 本 store 按 entityId 全量接收，与地图过滤无关。
 */
export interface EoCameraDdsStatusRow {
  taskType?: unknown;
  executionState?: unknown;
  online?: boolean;
  trackID?: unknown;
  targetID?: unknown;
  /** DDS 目标别名（与 Qt 标牌/DrawCircleTag 目标名同源字段，键名常见 trackAlias / track_alias） */
  trackAlias?: unknown;
  /** 方位角 °（DDS / Camera WS 常见 `azimuth`） */
  azimuth?: unknown;
  /** 航向角 °（常见 `course` / COG） */
  course?: unknown;
  /** 地速 m/s */
  speed?: unknown;
  /** 距离 m（与 Qt `rectTrackDis` 一致时标牌换算 NM = /1852） */
  distance?: unknown;
  /** 云台水平角 P（°），常见 `ptz.pan` / `p` */
  ptzPanDeg?: number;
  /** 云台俯仰（°），常见 `ptz.tilt` */
  ptzTiltDeg?: number;
  /** 变倍 / Z，常见 `ptz.zoom` */
  ptzZoom?: number;
  /** 全景方位补偿（°），与地图 `parseCameraBearingDeg` 中 panoOffset 一致 */
  panoOffsetDeg?: number;
  executionTimeMs?: unknown;
  updatedAt: number;
}

interface EoCameraDdsStatusState {
  byEntityId: Record<string, EoCameraDdsStatusRow>;
  /** 每条 Camera / optoelectronic WS 在分发入口调用一次 */
  ingestCameraPayload: (d: Record<string, unknown>) => void;
}

function parseFiniteNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const useEoCameraDdsStatusStore = create<EoCameraDdsStatusState>((set, get) => ({
  byEntityId: {},
  ingestCameraPayload: (d) => {
    const rawEntity = String(d.entityId ?? d.cameraId ?? d.deviceId ?? "").trim();
    if (!rawEntity) return;
    const entityId = canonicalEntityId(rawEntity) || rawEntity;
    const prev = get().byEntityId[entityId];
    const execIn =
      d.executionState !== undefined
        ? d.executionState
        : d.execution_state !== undefined
          ? d.execution_state
          : d.excute_state !== undefined
            ? d.excute_state
            : d.excuteState !== undefined
              ? d.excuteState
          : undefined;
    const trackPick = pickFromCameraPayload(d, [
      "trackID",
      "trackId",
      "track_id",
      "trackid",
      "targetID",
      "targetId",
      "target_id",
      "m_nTrackID",
      "rectTrackID",
    ]);
    const trackIn =
      trackPick !== undefined
        ? trackPick
        : d.trackID !== undefined
          ? d.trackID
          : d.trackId !== undefined
            ? d.trackId
            : d.track_id !== undefined
              ? d.track_id
              : d.targetID !== undefined
                ? d.targetID
                : d.targetId !== undefined
                  ? d.targetId
                  : d.target_id !== undefined
                    ? d.target_id
              : undefined;
    /** 勿用根上的 `name`：多为相机名称/状态文案（如「dds相机实时状态」），会误当航迹别名 */
    const aliasPick = pickFromCameraPayload(d, ["trackAlias", "track_alias"]);
    const aliasIn =
      aliasPick !== undefined
        ? aliasPick
        : d.trackAlias !== undefined
          ? d.trackAlias
          : d.track_alias !== undefined
            ? d.track_alias
            : undefined;
    const azRaw = pickFromCameraPayload(d, ["azimuth", "azi", "azimuth_deg", "azimuthDegrees", "azimuth_degrees"]);
    const azIn = azRaw !== undefined ? azRaw : undefined;
    const courseRaw = pickFromCameraPayload(d, ["course", "trackCourse", "track_course", "cog", "COG", "heading"]);
    const courseIn = courseRaw !== undefined ? courseRaw : undefined;
    const speedRaw = pickFromCameraPayload(d, ["speed", "trackSpeed", "track_speed", "speed_ms", "groundSpeed"]);
    const speedIn = speedRaw !== undefined ? speedRaw : undefined;
    const distRaw = pickFromCameraPayload(d, ["distance", "trackDis", "track_dis", "rectTrackDis", "range", "rangeM"]);
    const distIn = distRaw !== undefined ? distRaw : undefined;
    const ptzRec = asRecord(d.ptz);
    const panFromPtz = ptzRec ? parseFiniteNumber(ptzRec.pan) : undefined;
    const panPick = pickFromCameraPayload(d, ["pan", "p", "Pan", "P", "headingPan"]);
    const panMerged = panFromPtz ?? parseFiniteNumber(panPick);
    const tiltMerged =
      (ptzRec ? parseFiniteNumber(ptzRec.tilt) : undefined) ??
      parseFiniteNumber(pickFromCameraPayload(d, ["tilt", "T"]));
    const zoomMerged =
      (ptzRec ? parseFiniteNumber(ptzRec.zoom ?? ptzRec.z) : undefined) ??
      parseFiniteNumber(pickFromCameraPayload(d, ["zoom", "z", "Zoom"]));
    const panoMerged = parseFiniteNumber(d.panoOffset);
    const next: EoCameraDdsStatusRow = {
      taskType: d.taskType !== undefined ? d.taskType : d.task_type !== undefined ? d.task_type : prev?.taskType,
      executionState: execIn !== undefined ? execIn : prev?.executionState,
      online: d.online !== undefined ? Boolean(d.online) : prev?.online,
      trackID: trackIn !== undefined ? trackIn : prev?.trackID,
      targetID:
        d.targetID !== undefined
          ? d.targetID
          : d.targetId !== undefined
            ? d.targetId
            : d.target_id !== undefined
              ? d.target_id
              : prev?.targetID,
      trackAlias: aliasIn !== undefined ? aliasIn : prev?.trackAlias,
      azimuth: azIn !== undefined ? azIn : prev?.azimuth,
      course: courseIn !== undefined ? courseIn : prev?.course,
      speed: speedIn !== undefined ? speedIn : prev?.speed,
      distance: distIn !== undefined ? distIn : prev?.distance,
      ptzPanDeg: panMerged !== undefined ? panMerged : prev?.ptzPanDeg,
      ptzTiltDeg: tiltMerged !== undefined ? tiltMerged : prev?.ptzTiltDeg,
      ptzZoom: zoomMerged !== undefined ? zoomMerged : prev?.ptzZoom,
      panoOffsetDeg: panoMerged !== undefined ? panoMerged : prev?.panoOffsetDeg,
      executionTimeMs: d.executionTimeMs !== undefined ? d.executionTimeMs : prev?.executionTimeMs,
      updatedAt: Date.now(),
    };
    set((s) => ({
      byEntityId: { ...s.byEntityId, [entityId]: next },
    }));
  },
}));
