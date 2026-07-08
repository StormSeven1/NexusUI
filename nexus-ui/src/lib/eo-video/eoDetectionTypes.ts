/** WebSocket 推送的相机检测载荷（与 z_others base-vue CameraView 一致） */

export interface EoRectLayerPayload {
  header?: number[] | string | ArrayBuffer | Uint8Array | null;
  /** 每行 [x,y,w,h] 像素或 0–1；可选第 5 列为 rectID/trackId，供 VisualTrackingTask.m_nTrackID */
  videoRect?: number[][] | number[] | null;
  /** 可选：该检测层对应的视频帧标识（推荐后端提供） */
  frameId?: number | string | null;
  /** 可选：该检测层源帧时间戳（毫秒） */
  captureTs?: number | string | null;
  /** 可选：编码时间戳/PTS（毫秒） */
  encodeTs?: number | string | null;
}

export interface EoCameraWsPayload {
  entityId: string | number;
  videoWidth?: number;
  videoHeight?: number;
  frameId?: number | string | null;
  captureTs?: number | string | null;
  encodeTs?: number | string | null;
  p?: number | null;
  t?: number | null;
  z?: number | null;
  hs?: number | null;
  vs?: number | null;
  boatRect?: EoRectLayerPayload | null;
  planeRect?: EoRectLayerPayload | null;
  singleRect?: EoRectLayerPayload | null;
}

export interface BufferedDetectionEntry {
  /** 无 header 时仅走「最新一包」回退绘制，不参与 strict 对齐 */
  header: Uint8Array | null;
  /** 像素或 0–1 框；可为 [x,y,w,h] 或 [x,y,w,h,trackId]（与相机 rectID 对齐） */
  videoRects: number[][];
  videoWidth: number;
  videoHeight: number;
  frameId?: number;
  captureTs?: number;
  encodeTs?: number;
  receivedAt: number;
  /**
   * singleRect 首框展示元数据（与 Qt `rectTrackName` / `rectType` 及 DrawCircleTag 圆内「海|空」对齐）。
   * 由 WS `videoRect` 首条对象字段解析；纯数组框时为空。
   */
  singleDisplayMeta?: {
    trackName?: string;
    typeShort?: string;
    /** 方位角 ° */
    azimuthDeg?: number;
    /** 距离 m（与 Qt `rectTrackDis` 一致，标牌换算 NM = /1852） */
    distanceM?: number;
    /** 地速 m/s */
    speedMps?: number;
    /** 航向角 °（COG） */
    courseDeg?: number;
  };
}

export interface MatchState {
  lastSuccess: BufferedDetectionEntry | null;
  failureCount: number;
  maxFailures: number;
  isActive: boolean;
}

/** 一条 WS 相机载荷的原子快照（与 sei_poc_test wsBuffer 条目一致：同包 boat/plane/single + headers） */
export interface WsDetectionSnapshot {
  receivedAt: number;
  videoWidth: number;
  videoHeight: number;
  frameId?: number;
  captureTs?: number;
  boat: BufferedDetectionEntry | null;
  plane: BufferedDetectionEntry | null;
  single: BufferedDetectionEntry | null;
  headers: Uint8Array[];
}

export interface UnifiedWsMatchState {
  lastSuccess: WsDetectionSnapshot | null;
  failureCount: number;
  maxFailures: number;
  isActive: boolean;
}
