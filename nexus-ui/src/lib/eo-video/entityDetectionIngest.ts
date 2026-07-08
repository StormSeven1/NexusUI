import type {
  BufferedDetectionEntry,
  EoCameraWsPayload,
  EoRectLayerPayload,
  WsDetectionSnapshot,
} from "@/lib/eo-video/eoDetectionTypes";
import { inferEoSurfaceShortFromRectTypeId, parseDetectionHeader } from "@/lib/eo-video/detectionSyncUtils";

/** 与 sync 环容量同量级即可；过大时每帧 header 扫描与 cross 诊断更重 */
export const ENTITY_DETECTION_BUFFER_CAP = 64;

function pickStrFromRecord(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickFiniteNumberFromRecord(r: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = r[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** 第 5 列优先航迹 ID，避免把检测 rectID 当成 m_nTrackID（与 Qt `rectTrackID` 语义对齐） */
function pickRectRowFifthFromRecord(r: Record<string, unknown>): unknown {
  const trackKeys = [
    "m_nTrackID",
    "mNTrackID",
    "rectTrackID",
    "rectTrackId",
    "trackId",
    "trackID",
    "nTrackID",
    "visualTrackingTrackId",
  ];
  for (const k of trackKeys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v) !== "0") return v;
  }
  return r.rectID ?? r.rectId ?? r.trackID ?? r.trackId;
}

/** 仅海/空二分类（与 Qt 船矶浮 ↔ 海、鸟机 ↔ 空 一致）；无法识别返回 undefined。 */
function inferTypeShortFromRecord(r: Record<string, unknown>): string | undefined {
  const rt =
    r.rectType ??
    r.rect_type ??
    r.rectTypeId ??
    r.rect_type_id ??
    r.shipType ??
    r.ship_type ??
    r.targetTypeId ??
    r.target_type_id ??
    r.type ??
    r.targetType ??
    r.target_type ??
    r.classId ??
    r.class_id ??
    r.category ??
    r.targetClass ??
    r.target_class;
  const s = String(rt ?? "").toLowerCase();
  if (/plane|air|bird|uav|drone|空|机|鸟|aircraft/.test(s)) return "空";
  if (/ship|boat|vessel|buoy|海|船|浮|surface/.test(s)) return "海";
  const n = Number(rt);
  if (Number.isFinite(n)) {
    return inferEoSurfaceShortFromRectTypeId(Math.trunc(n));
  }
  return undefined;
}

/** 从 singleRect.videoRect 首条对象解析目标名与类型字（纯数组几何时返回 undefined） */
function parseSingleRectDisplayMetaFromPayload(
  layer: EoRectLayerPayload | null | undefined,
  parentData?: EoCameraWsPayload | null,
): NonNullable<BufferedDetectionEntry["singleDisplayMeta"]> | undefined {
  if (!layer) return undefined;
  const baseRec = layer as unknown as Record<string, unknown>;
  const parentRec = (parentData ?? null) as unknown as Record<string, unknown> | null;
  const vr = layer.videoRect as unknown;
  let firstRowRec: Record<string, unknown> | null = null;
  if (Array.isArray(vr) && vr.length > 0) {
    const first = vr[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      firstRowRec = first as Record<string, unknown>;
    }
  } else if (vr && typeof vr === "object" && !Array.isArray(vr)) {
    firstRowRec = vr as Record<string, unknown>;
  }
  const rec = firstRowRec ?? baseRec;
  const typeShort =
    inferTypeShortFromRecord(rec) ??
    inferTypeShortFromRecord(baseRec) ??
    (parentRec ? inferTypeShortFromRecord(parentRec) : undefined);
  const trackName = pickStrFromRecord(rec, [
    "trackAlias",
    "track_alias",
    "trackName",
    "targetName",
    "name",
    "shipName",
    "target_name",
    "track_name",
  ]);
  const azimuthDeg = pickFiniteNumberFromRecord(rec, [
    "azimuth",
    "azi",
    "azimuthDeg",
    "azimuth_degrees",
    "azimuthDegrees",
    "heading",
  ]);
  const distanceM = pickFiniteNumberFromRecord(rec, [
    "rectTrackDis",
    "trackDis",
    "distance",
    "dis",
    "range",
    "rangeM",
    "slantRange",
  ]);
  const speedMps = pickFiniteNumberFromRecord(rec, ["trackSpeed", "speed", "spd", "velocity", "groundSpeed"]);
  const courseDeg = pickFiniteNumberFromRecord(rec, ["trackCourse", "course", "cog", "COG", "bearing", "headingDeg"]);
  const out: NonNullable<BufferedDetectionEntry["singleDisplayMeta"]> = {
    trackName: trackName || undefined,
    ...(typeShort ? { typeShort } : {}),
  };
  if (azimuthDeg !== undefined) out.azimuthDeg = azimuthDeg;
  if (distanceM !== undefined) out.distanceM = distanceM;
  if (speedMps !== undefined) out.speedMps = speedMps;
  if (courseDeg !== undefined) out.courseDeg = courseDeg;
  return out;
}

/**
 * 发送端常见：`{ x, y, width, height, rectID }`（rectID 可为字符串），转成与旧格式一致的 [x,y,w,h] 或 [x,y,w,h,trackId]。
 */
function rectRowFromRecord(o: unknown): number[] | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const x = Number(r.x);
  const y = Number(r.y);
  const w = Number(r.width ?? r.w);
  const h = Number(r.height ?? r.h);
  if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
  if (w <= 0 || h <= 0) return null;
  const ridRaw = pickRectRowFifthFromRecord(r);
  const row: number[] = [x, y, w, h];
  if (ridRaw !== undefined && ridRaw !== null && String(ridRaw) !== "" && String(ridRaw) !== "0") {
    const tid = Number(ridRaw);
    if (Number.isFinite(tid)) row.push(tid);
  }
  const rtRaw =
    r.rectType ??
    r.rect_type ??
    r.classId ??
    r.class_id ??
    r.targetTypeId ??
    r.target_type_id;
  if (rtRaw !== undefined && rtRaw !== null && String(rtRaw).trim() !== "") {
    const rt = Number(rtRaw);
    if (Number.isFinite(rt) && rt > 0) row.push(Math.trunc(rt));
  }
  return row;
}

function pushRectRowFromNumbers(rects: number[][], row: number[]) {
  if (row.length >= 6) {
    rects.push([
      Number(row[0]),
      Number(row[1]),
      Number(row[2]),
      Number(row[3]),
      Number(row[4]),
      Number(row[5]),
    ]);
  } else if (row.length >= 5) {
    rects.push([Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4])]);
  } else {
    rects.push([Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3])]);
  }
}

/**
 * 解析一层 `videoRect`。
 * - `null`：本层未携带可解析的几何（不更新缓冲）。
 * - `[]`：显式「无框」，应写入缓冲以清掉旧框。
 */
export function extractVideoRectsFromLayer(layer: EoCameraWsPayload["boatRect"]): number[][] | null {
  if (!layer?.videoRect) return null;
  const vr = layer.videoRect as unknown;

  if (Array.isArray(vr)) {
    if (vr.length === 0) return [];
    if (typeof vr[0] === "number") {
      const flat = vr as number[];
      if (flat.length < 4) return null;
      const row = flat.slice(0, Math.min(flat.length, 6)).map(Number);
      return [row];
    }
    const rects: number[][] = [];
    for (const row of vr) {
      if (Array.isArray(row) && row.length >= 4) {
        pushRectRowFromNumbers(rects, row.map(Number));
      } else {
        const conv = rectRowFromRecord(row);
        if (conv) rects.push(conv);
      }
    }
    return rects.length ? rects : [];
  }

  const one = rectRowFromRecord(vr);
  return one ? [one] : null;
}

export interface EntityIngestResult {
  /** 本包对船层做了「显式空框」写入，已清空该层旧缓冲 */
  clearedBoat: boolean;
  clearedPlane: boolean;
  clearedSingle: boolean;
}

function pushBuffer(arr: BufferedDetectionEntry[], entry: BufferedDetectionEntry) {
  arr.push(entry);
  if (arr.length > ENTITY_DETECTION_BUFFER_CAP) arr.shift();
}

/** 过滤 w/h≤0 的无效框；后端清除时可能发 [0,0,0,0] 而非空数组 */
function filterPositiveSizeRects(rects: number[][]): number[][] {
  return rects.filter((r) => r.length >= 4 && Number(r[2]) > 0 && Number(r[3]) > 0);
}

function toFiniteNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

let _headerDiagDone = false;
let _rectIdDiagDone = false;

/** 将一条 WS 相机载荷写入船/机/单目标缓冲；可选写入 unifiedBuf（与 sei_poc_test wsBuffer 同包原子性） */
export function ingestEntityDetectionPayload(
  data: EoCameraWsPayload,
  boatBuf: BufferedDetectionEntry[],
  planeBuf: BufferedDetectionEntry[],
  singleBuf: BufferedDetectionEntry[],
  unifiedBuf?: WsDetectionSnapshot[],
): EntityIngestResult {
  const receivedAt = Date.now();
  const vw = Number(data.videoWidth) || 0;
  const vh = Number(data.videoHeight) || 0;
  const topFrameId = toFiniteNumber(data.frameId);
  const topCaptureTs = toFiniteNumber(data.captureTs);
  const topEncodeTs = toFiniteNumber(data.encodeTs);
  const cleared: EntityIngestResult = { clearedBoat: false, clearedPlane: false, clearedSingle: false };
  let snapBoat: BufferedDetectionEntry | null = null;
  let snapPlane: BufferedDetectionEntry | null = null;
  let snapSingle: BufferedDetectionEntry | null = null;
  const snapHeaders: Uint8Array[] = [];

  const rememberHeader = (entry: BufferedDetectionEntry) => {
    if (entry.header?.byteLength) snapHeaders.push(entry.header);
  };

  // 一次性诊断：打印 WS header 原始信息
  if (!_headerDiagDone) {
    const rawH = data.boatRect?.header ?? data.planeRect?.header ?? data.singleRect?.header;
    if (rawH != null) {
      _headerDiagDone = true;
      const parsed = parseDetectionHeader(rawH);
      console.log("[eo-detect] WS header diag:", {
        rawType: typeof rawH,
        isArray: Array.isArray(rawH),
        rawLen: Array.isArray(rawH) ? rawH.length : typeof rawH === "string" ? rawH.length : "?",
        rawSample: Array.isArray(rawH) ? (rawH as number[]).slice(0, 8) : typeof rawH === "string" ? rawH.slice(0, 80) : rawH,
        parsedLen: parsed?.length,
        parsedHex: parsed ? Array.from(parsed.slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join("") : null,
      });
    }
  }

  if (data.boatRect) {
    const rects = extractVideoRectsFromLayer(data.boatRect);
    if (!_rectIdDiagDone && rects && rects.length > 0) {
      _rectIdDiagDone = true;
      const sampleRows = rects.slice(0, 3).map((r) => ({
        rowLen: r.length,
        xywh: r.slice(0, 4),
        fifth: r.length >= 5 ? r[4] : null,
      }));
      console.log("[eo-detect] rect id diag:", {
        layer: "boatRect",
        rows: rects.length,
        sampleRows,
        // 若后端仍发对象格式，可从原始结构确认字段是否存在
        rawVideoRectType: Array.isArray(data.boatRect.videoRect) ? "array" : typeof data.boatRect.videoRect,
        rawFirstObj:
          Array.isArray(data.boatRect.videoRect) &&
          data.boatRect.videoRect.length > 0 &&
          !Array.isArray(data.boatRect.videoRect[0])
            ? data.boatRect.videoRect[0]
            : null,
      });
    }
    if (rects !== null) {
      if (rects.length === 0) {
        boatBuf.length = 0;
        cleared.clearedBoat = true;
      } else {
        const entry: BufferedDetectionEntry = {
          header: parseDetectionHeader(data.boatRect.header),
          videoRects: rects,
          videoWidth: vw,
          videoHeight: vh,
          frameId: toFiniteNumber(data.boatRect.frameId) ?? topFrameId,
          captureTs: toFiniteNumber(data.boatRect.captureTs) ?? topCaptureTs,
          encodeTs: toFiniteNumber(data.boatRect.encodeTs) ?? topEncodeTs,
          receivedAt,
        };
        pushBuffer(boatBuf, entry);
        snapBoat = entry;
        rememberHeader(entry);
      }
    }
  }
  if (data.planeRect) {
    const rects = extractVideoRectsFromLayer(data.planeRect);
    if (!_rectIdDiagDone && rects && rects.length > 0) {
      _rectIdDiagDone = true;
      const sampleRows = rects.slice(0, 3).map((r) => ({
        rowLen: r.length,
        xywh: r.slice(0, 4),
        fifth: r.length >= 5 ? r[4] : null,
      }));
      console.log("[eo-detect] rect id diag:", {
        layer: "planeRect",
        rows: rects.length,
        sampleRows,
        rawVideoRectType: Array.isArray(data.planeRect.videoRect) ? "array" : typeof data.planeRect.videoRect,
        rawFirstObj:
          Array.isArray(data.planeRect.videoRect) &&
          data.planeRect.videoRect.length > 0 &&
          !Array.isArray(data.planeRect.videoRect[0])
            ? data.planeRect.videoRect[0]
            : null,
      });
    }
    if (rects !== null) {
      if (rects.length === 0) {
        planeBuf.length = 0;
        cleared.clearedPlane = true;
      } else {
        const entry: BufferedDetectionEntry = {
          header: parseDetectionHeader(data.planeRect.header),
          videoRects: rects,
          videoWidth: vw,
          videoHeight: vh,
          frameId: toFiniteNumber(data.planeRect.frameId) ?? topFrameId,
          captureTs: toFiniteNumber(data.planeRect.captureTs) ?? topCaptureTs,
          encodeTs: toFiniteNumber(data.planeRect.encodeTs) ?? topEncodeTs,
          receivedAt,
        };
        pushBuffer(planeBuf, entry);
        snapPlane = entry;
        rememberHeader(entry);
      }
    }
  }
  if (data.singleRect) {
    const rects = extractVideoRectsFromLayer(data.singleRect);
    const validRects = rects !== null ? filterPositiveSizeRects(rects) : null;
    if (!_rectIdDiagDone && validRects && validRects.length > 0) {
      _rectIdDiagDone = true;
      const sampleRows = validRects.slice(0, 3).map((r) => ({
        rowLen: r.length,
        xywh: r.slice(0, 4),
        fifth: r.length >= 5 ? r[4] : null,
      }));
      console.log("[eo-detect] rect id diag:", {
        layer: "singleRect",
        rows: validRects.length,
        sampleRows,
        rawVideoRectType: Array.isArray(data.singleRect.videoRect) ? "array" : typeof data.singleRect.videoRect,
        rawFirstObj:
          Array.isArray(data.singleRect.videoRect) &&
          data.singleRect.videoRect.length > 0 &&
          !Array.isArray(data.singleRect.videoRect[0])
            ? data.singleRect.videoRect[0]
            : null,
      });
    }
    if (validRects !== null) {
      if (validRects.length === 0) {
        /** 对齐 base-vue：显式空 singleRect 清空缓冲并重置 sync 滞回 */
        singleBuf.length = 0;
        cleared.clearedSingle = true;
      } else {
        const entry: BufferedDetectionEntry = {
          header: parseDetectionHeader(data.singleRect.header),
          videoRects: validRects,
          videoWidth: vw,
          videoHeight: vh,
          frameId: toFiniteNumber(data.singleRect.frameId) ?? topFrameId,
          captureTs: toFiniteNumber(data.singleRect.captureTs) ?? topCaptureTs,
          encodeTs: toFiniteNumber(data.singleRect.encodeTs) ?? topEncodeTs,
          receivedAt,
          singleDisplayMeta: parseSingleRectDisplayMetaFromPayload(data.singleRect, data),
        };
        pushBuffer(singleBuf, entry);
        snapSingle = entry;
        rememberHeader(entry);
      }
    }
  }

  if (unifiedBuf) {
    unifiedBuf.push({
      receivedAt,
      videoWidth: vw,
      videoHeight: vh,
      frameId: topFrameId,
      captureTs: topCaptureTs,
      boat: snapBoat,
      plane: snapPlane,
      single: snapSingle,
      headers: snapHeaders,
    });
    while (unifiedBuf.length > ENTITY_DETECTION_BUFFER_CAP) unifiedBuf.shift();
  }

  return cleared;
}
