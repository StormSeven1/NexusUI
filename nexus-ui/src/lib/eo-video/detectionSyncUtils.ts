import type { BufferedDetectionEntry, MatchState } from "@/lib/eo-video/eoDetectionTypes";
import type { EoDetectionBox } from "@/lib/eo-video/types";

/**
 * 与 base-vue 后端 C++ 一致：32 字节 syncHeader（4B size + 28B NAL）。
 */
const HEADER_LEN = 32;

/** 将 WS JSON 中的 header 转为 Uint8Array（与 base-vue websocketService 一致） */
export function parseDetectionHeader(headerData: unknown): Uint8Array | null {
  if (headerData == null) return null;
  if (headerData instanceof Uint8Array) return headerData.byteLength ? headerData : null;
  if (Array.isArray(headerData)) {
    const u = new Uint8Array(headerData.length);
    for (let i = 0; i < headerData.length; i++) u[i] = Number(headerData[i]) & 0xff;
    return u.byteLength ? u : null;
  }
  /** JSON 反序列化后偶见 { "0": n, "1": n, ... } */
  if (typeof headerData === "object" && headerData !== null && !(headerData instanceof ArrayBuffer)) {
    const o = headerData as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) {
      const u = new Uint8Array(keys.length);
      for (let i = 0; i < keys.length; i++) u[i] = Number(o[keys[i]!]) & 0xff;
      return u.byteLength ? u : null;
    }
  }
  if (headerData instanceof ArrayBuffer) {
    const u = new Uint8Array(headerData);
    return u.byteLength ? u : null;
  }
  if (typeof headerData === "string") {
    const s = headerData.trim();
    // 优先尝试 hex（后端 C++ 发的就是 hex 字符串，如 "000047d061e3c003..."）
    // 必须先于 base64，因为纯 hex 字符串也是合法 base64
    const cleanHex = s.replace(/^0x/i, "").replace(/\s+/g, "");
    if (/^[0-9a-fA-F]+$/.test(cleanHex) && cleanHex.length >= 8) {
      try {
        const hex = cleanHex.length % 2 === 0 ? cleanHex : `0${cleanHex}`;
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
        }
        if (bytes.byteLength) return bytes;
      } catch {
        /* fall through base64 */
      }
    }
    if (/^[A-Za-z0-9+/]+=*$/.test(s) && s.length >= 8 && s.length % 4 === 0) {
      try {
        const bin = atob(s);
        if (!bin.length) return null;
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i) & 0xff;
        return u;
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

/** 与 base-vue 一致：优先整包相等；长度不一致时若两侧均 ≥32B 则只比对前 HEADER_LEN 字节（兼容后端 32/48B 变体）。 */
export function headersMatch(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b) return false;
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  if (Math.min(a.length, b.length) < HEADER_LEN) return false;
  for (let i = 0; i < HEADER_LEN; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** 回退打包（HEADER_LEN 字节） */
export function createSyncHeader(frameInfo: {
  timestamp?: number;
  bytesReceived?: number;
  width?: number;
  height?: number;
  frameWidth?: number;
  frameHeight?: number;
}): Uint8Array {
  const packetSize = (frameInfo.bytesReceived || frameInfo.timestamp || 1024) >>> 0;
  const headerData = new ArrayBuffer(HEADER_LEN);
  const view = new DataView(headerData);
  view.setUint32(0, packetSize >>> 0, false);

  const nalLen = HEADER_LEN - 4;
  const simulatedNal = new Uint8Array(nalLen);
  const timestamp = frameInfo.timestamp ?? Date.now();
  const width = frameInfo.frameWidth ?? frameInfo.width ?? 0;
  const height = frameInfo.frameHeight ?? frameInfo.height ?? 0;
  simulatedNal[0] = (timestamp >>> 24) & 0xff;
  simulatedNal[1] = (timestamp >>> 16) & 0xff;
  simulatedNal[2] = (timestamp >>> 8) & 0xff;
  simulatedNal[3] = timestamp & 0xff;
  simulatedNal[4] = (width >>> 8) & 0xff;
  simulatedNal[5] = width & 0xff;
  simulatedNal[6] = (height >>> 8) & 0xff;
  simulatedNal[7] = height & 0xff;
  for (let i = 8; i < nalLen; i++) {
    simulatedNal[i] = ((timestamp * (i + 1)) >>> (i % 8)) & 0xff;
  }
  const headerView = new Uint8Array(headerData);
  for (let i = 0; i < nalLen; i++) headerView[i + 4] = simulatedNal[i];
  return headerView;
}

/**
 * 从 RTP 编码帧 payload 生成 HEADER_LEN 字节 syncHeader。
 * 结构：4 字节 big-endian 包大小 + (HEADER_LEN-4) 字节 NAL 数据。
 * `headersMatch` 在两侧长度均 ≥HEADER_LEN 时比对前 HEADER_LEN 字节，兼容后端 32/48 字节变体。
 */
export function createSyncHeaderFromEncodedFrame(encoded: {
  data: ArrayBuffer | ArrayBufferView;
  timestamp?: number;
}): Uint8Array {
  const src =
    encoded.data instanceof ArrayBuffer
      ? new Uint8Array(encoded.data)
      : new Uint8Array(encoded.data.buffer, encoded.data.byteOffset, encoded.data.byteLength);
  if (!src.byteLength) {
    return createSyncHeader({
      timestamp: encoded.timestamp ?? Date.now(),
      width: 0,
      height: 0,
    });
  }

  const headerData = new ArrayBuffer(HEADER_LEN);
  const view = new DataView(headerData);
  view.setUint32(0, src.byteLength, false);

  const nalLen = HEADER_LEN - 4;
  const nalData = new Uint8Array(nalLen);
  if (src.length >= HEADER_LEN) {
    let offset = 4;
    if (src[0] === 0x00 && src[1] === 0x00 && src[2] === 0x01) {
      offset = 3;
    } else if (src[0] === 0x00 && src[1] === 0x00 && src[2] === 0x00 && src[3] === 0x01) {
      offset = 4;
    }
    for (let i = 0; i < nalLen; i++) {
      nalData[i] = src[i + offset] ?? 0;
    }
  } else {
    const timestamp = encoded.timestamp ?? Date.now();
    for (let i = 0; i < nalLen; i++) {
      nalData[i] = ((timestamp * (i + 1)) >>> (i % 8)) & 0xff;
    }
  }

  const headerView = new Uint8Array(headerData);
  for (let i = 0; i < nalLen; i++) headerView[i + 4] = nalData[i];
  return headerView;
}

export async function getCurrentVideoSyncHeader(
  video: HTMLVideoElement | null,
  pc: RTCPeerConnection | null,
): Promise<Uint8Array | null> {
  // 与 base-vue 思路一致：优先用“当前正在显示的画面信息”快速生成同步头，避免每帧都等待 getStats 造成滞后。
  if (video && (video.videoWidth > 0 || video.videoHeight > 0)) {
    return createSyncHeader({
      timestamp: Date.now(),
      width: video.videoWidth,
      height: video.videoHeight,
    });
  }

  try {
    if (pc) {
      const stats = await pc.getStats();
      for (const stat of stats.values()) {
        const s = stat as RTCInboundRtpStreamStats & {
          kind?: string;
          mediaType?: string;
          bytesReceived?: number;
          packetsReceived?: number;
          framesDecoded?: number;
          frameWidth?: number;
          frameHeight?: number;
        };
        if (s.type === "inbound-rtp" && (s.kind === "video" || s.mediaType === "video")) {
          return createSyncHeader({
            timestamp: s.timestamp ?? Date.now(),
            bytesReceived: s.bytesReceived,
            frameWidth: s.frameWidth || video?.videoWidth || 0,
            frameHeight: s.frameHeight || video?.videoHeight || 0,
          });
        }
      }
    }
  } catch {
    /* ignore */
  }

  return createSyncHeader({ timestamp: Date.now(), width: 0, height: 0 });
}

export interface ProcessDetectionMatchOptions {
  /**
   * true（默认）：与 base-vue 一致，短时对不齐 header 时仍返回上次成功项，避免闪断。
   * false：仅用于 WebRTC 编码帧严格对齐；对不齐立即放弃 lastSuccess，避免「画面已动、旧框拖很久」。
   */
  holdLastSuccess?: boolean;
}

export function processDetectionMatch(
  dataArray: BufferedDetectionEntry[],
  currentSyncHeader: Uint8Array,
  matchState: MatchState,
  options?: ProcessDetectionMatchOptions,
): BufferedDetectionEntry | null {
  const holdLastSuccess = options?.holdLastSuccess !== false;

  let foundIndex = -1;
  let found: BufferedDetectionEntry | null = null;

  for (let i = dataArray.length - 1; i >= 0; i--) {
    const data = dataArray[i];
    if (data.header && headersMatch(data.header, currentSyncHeader)) {
      found = data;
      foundIndex = i;
      break;
    }
  }

  if (found && foundIndex >= 0) {
    matchState.lastSuccess = found;
    matchState.failureCount = 0;
    matchState.isActive = true;
    dataArray.splice(foundIndex, 1);
    return found;
  }

  matchState.failureCount++;
  if (holdLastSuccess && matchState.failureCount <= matchState.maxFailures && matchState.lastSuccess) {
    return matchState.lastSuccess;
  }
  if (matchState.isActive) {
    matchState.isActive = false;
    matchState.lastSuccess = null;
  }
  return null;
}

/** 从 videoRect 行解析可选的第 5 列：相机/融合 rectID（与 Qt vecRect.ID 语义对齐） */
export function rectRowServerTrackId(rect: number[] | undefined): number | undefined {
  if (!rect || rect.length < 5) return undefined;
  const v = Number(rect[4]);
  if (!Number.isFinite(v)) return undefined;
  return Math.trunc(v);
}

/** 检测算法像素坐标系缺 WS 尺寸时的缺省（与 camServer / 8304 常见输出一致，非 WebCodecs 呈现尺寸） */
const DEFAULT_DETECTION_FRAME_W = 1920;
const DEFAULT_DETECTION_FRAME_H = 1080;

/** WS 无 videoWidth/Height 时推断检测帧尺寸（不可用框外包络或 WebCodecs canvas 尺寸） */
export function inferFrameSizeFromPixelRects(rects: number[][]): { w: number; h: number } | null {
  let maxR = 0;
  let maxB = 0;
  for (const r of rects) {
    if (!r || r.length < 4) continue;
    const [x, y, w, h] = r.map((v) => Number(v));
    if (![x, y, w, h].every(Number.isFinite)) continue;
    if (Math.max(x, y, w, h) <= 1.001) continue;
    maxR = Math.max(maxR, x + w);
    maxB = Math.max(maxB, y + h);
  }
  if (maxR <= 1 || maxB <= 1) return null;
  // 像素框在 1920×1080 系；用 max(x+w) 当整帧宽会把框归一化算偏（Qt 直接用解码宽，不走此路径）
  if (maxR > 640 || maxB > 480) {
    return { w: DEFAULT_DETECTION_FRAME_W, h: DEFAULT_DETECTION_FRAME_H };
  }
  return { w: Math.max(640, Math.ceil(maxR)), h: Math.max(480, Math.ceil(maxB)) };
}

/** 可信的 WS / 解码帧宽（排除 CheckFindRect 误写的 ~700 级「框外包络」尺寸） */
function isPlausibleDetectionFrameSize(w: number, h: number): boolean {
  return w >= 1280 && h >= 720;
}

export function resolveDetectionFrameSize(
  rects: number[][],
  sources: {
    entryW?: number;
    entryH?: number;
    /** 当前屏幕呈现宽（WebCodecs Canvas / 可见 video），优先于隐藏 video 元数据 */
    presentationW?: number;
    presentationH?: number;
    videoW?: number;
    videoH?: number;
  },
): { w: number; h: number } {
  const entryW = sources.entryW ?? 0;
  const entryH = sources.entryH ?? 0;
  if (isPlausibleDetectionFrameSize(entryW, entryH)) return { w: entryW, h: entryH };

  const presW = sources.presentationW ?? 0;
  const presH = sources.presentationH ?? 0;
  if (isPlausibleDetectionFrameSize(presW, presH)) return { w: presW, h: presH };

  const videoW = sources.videoW ?? 0;
  const videoH = sources.videoH ?? 0;
  if (isPlausibleDetectionFrameSize(videoW, videoH)) return { w: videoW, h: videoH };

  const inferred = inferFrameSizeFromPixelRects(rects);
  if (inferred) {
    if (presW > 0 && presH > 0) return { w: presW, h: presH };
    if (videoW > 0 && videoH > 0) return { w: videoW, h: videoH };
    return inferred;
  }

  if (entryW > 0 && entryH > 0) return { w: entryW, h: entryH };
  if (presW > 0 && presH > 0) return { w: presW, h: presH };
  return { w: videoW, h: videoH };
}

/**
 * 检测归一化坐标所依据的帧尺寸 ≠ 当前呈现尺寸时，映射到呈现空间 0–1（与 base-vue convertRectToDisplaySize 同源思路）。
 */
export function mapEoBoxToPresentationNorm(
  box: EoDetectionBox,
  presentationW: number,
  presentationH: number,
): { x: number; y: number; w: number; h: number } {
  const fw = box.frameWidth ?? 0;
  const fh = box.frameHeight ?? 0;
  if (
    fw > 0 &&
    fh > 0 &&
    presentationW > 0 &&
    presentationH > 0 &&
    (fw !== presentationW || fh !== presentationH)
  ) {
    const px = box.x * fw;
    const py = box.y * fh;
    const pw = box.w * fw;
    const ph = box.h * fh;
    return {
      x: px / presentationW,
      y: py / presentationH,
      w: pw / presentationW,
      h: ph / presentationH,
    };
  }
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

/** 后端是否已给 0–1 相对视频分辨率的框（再除以 videoWidth 会画飞） */
export function rectsLookNormalized(rects: number[][]): boolean {
  if (!rects.length) return false;
  for (const r of rects) {
    if (!r || r.length < 4) return false;
    const xywh = r.slice(0, 4);
    if (xywh.some((v) => v > 1.001 || v < -0.001)) return false;
  }
  return true;
}

/** 像素矩形 → 相对视频画面的 0–1（与 EoDetectionOverlay 约定一致） */
function pixelRectsToNormalizedBoxes(
  rects: number[][],
  videoWidth: number,
  videoHeight: number,
  idPrefix: string,
  label: string,
  colorToken: "friendly" | "hostile" | "neutral" | "accent",
): EoDetectionBox[] {
  if (!videoWidth || !videoHeight) return [];
  const out: EoDetectionBox[] = [];
  rects.forEach((rect, j) => {
    if (!rect || rect.length < 4) return;
    const [x, y, w, h] = rect;
    if (w <= 0 || h <= 0) return;
    const tid = rectRowServerTrackId(rect);
    const idSuffix = tid !== undefined ? tid : j;
    out.push({
      id: `${idPrefix}-${idSuffix}`,
      ...(tid !== undefined ? { trackId: tid } : {}),
      label,
      x: x / videoWidth,
      y: y / videoHeight,
      w: w / videoWidth,
      h: h / videoHeight,
      colorToken,
    });
  });
  return out;
}

/** 自动区分「像素框」与「已是 0–1 的框」 */
export function detectionRectsToEoBoxes(
  rects: number[][],
  videoWidth: number,
  videoHeight: number,
  idPrefix: string,
  label: string,
  colorToken: "friendly" | "hostile" | "neutral" | "accent",
): EoDetectionBox[] {
  if (!rects.length) return [];
  if (rectsLookNormalized(rects)) {
    const out: EoDetectionBox[] = [];
    rects.forEach((rect, j) => {
      if (!rect || rect.length < 4) return;
      const [x, y, w, h] = rect;
      if (w <= 0 || h <= 0) return;
      const tid = rectRowServerTrackId(rect);
      const idSuffix = tid !== undefined ? tid : j;
      out.push({
        id: `${idPrefix}-${idSuffix}`,
        ...(tid !== undefined ? { trackId: tid } : {}),
        label,
        x,
        y,
        w,
        h,
        colorToken,
      });
    });
    return out;
  }
  if (!videoWidth || !videoHeight) return [];
  return pixelRectsToNormalizedBoxes(rects, videoWidth, videoHeight, idPrefix, label, colorToken);
}

/** 检测框列表浅比较：避免每帧新数组引用触发父级 setState 循环 */
export function eoDetectionBoxesEqual(a: EoDetectionBox[], b: EoDetectionBox[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.trackId !== y.trackId ||
      x.label !== y.label ||
      x.x !== y.x ||
      x.y !== y.y ||
      x.w !== y.w ||
      x.h !== y.h ||
      x.score !== y.score ||
      x.colorToken !== y.colorToken ||
      x.variant !== y.variant ||
      x.singleTagShort !== y.singleTagShort ||
      x.singleTrackOverlayTitle !== y.singleTrackOverlayTitle ||
      x.ddsTrackId !== y.ddsTrackId ||
      x.frameWidth !== y.frameWidth ||
      x.frameHeight !== y.frameHeight
    ) {
      return false;
    }
    const xd = x.singleTrackDetail;
    const yd = y.singleTrackDetail;
    if (xd !== yd) {
      if (!xd || !yd) return false;
      if (
        xd.azimuthDeg !== yd.azimuthDeg ||
        xd.distanceM !== yd.distanceM ||
        xd.speedMps !== yd.speedMps ||
        xd.courseDeg !== yd.courseDeg
      ) {
        return false;
      }
    }
  }
  return true;
}
