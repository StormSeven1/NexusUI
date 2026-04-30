import type { BufferedDetectionEntry, EoCameraWsPayload } from "@/lib/eo-video/eoDetectionTypes";
import { parseDetectionHeader } from "@/lib/eo-video/detectionSyncUtils";

export const ENTITY_DETECTION_BUFFER_CAP = 200;

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
  const ridRaw = r.rectID ?? r.rectId ?? r.trackID ?? r.trackId;
  const row: number[] = [x, y, w, h];
  if (ridRaw !== undefined && ridRaw !== null && String(ridRaw) !== "" && String(ridRaw) !== "0") {
    const tid = Number(ridRaw);
    if (Number.isFinite(tid)) row.push(tid);
  }
  return row;
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
      return flat.length >= 5
        ? [[Number(flat[0]), Number(flat[1]), Number(flat[2]), Number(flat[3]), Number(flat[4])]]
        : [[Number(flat[0]), Number(flat[1]), Number(flat[2]), Number(flat[3])]];
    }
    const rects: number[][] = [];
    for (const row of vr) {
      if (Array.isArray(row) && row.length >= 4) {
        rects.push(
          row.length >= 5
            ? [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4])]
            : [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3])],
        );
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

function toFiniteNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

let _headerDiagDone = false;
let _rectIdDiagDone = false;

/** 将一条 WS 相机载荷写入船/机/单目标缓冲 */
export function ingestEntityDetectionPayload(
  data: EoCameraWsPayload,
  boatBuf: BufferedDetectionEntry[],
  planeBuf: BufferedDetectionEntry[],
  singleBuf: BufferedDetectionEntry[],
): EntityIngestResult {
  const vw = Number(data.videoWidth) || 0;
  const vh = Number(data.videoHeight) || 0;
  const topFrameId = toFiniteNumber(data.frameId);
  const topCaptureTs = toFiniteNumber(data.captureTs);
  const topEncodeTs = toFiniteNumber(data.encodeTs);
  const cleared: EntityIngestResult = { clearedBoat: false, clearedPlane: false, clearedSingle: false };

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
      }
      pushBuffer(boatBuf, {
        header: parseDetectionHeader(data.boatRect.header),
        videoRects: rects,
        videoWidth: vw,
        videoHeight: vh,
        frameId: toFiniteNumber(data.boatRect.frameId) ?? topFrameId,
        captureTs: toFiniteNumber(data.boatRect.captureTs) ?? topCaptureTs,
        encodeTs: toFiniteNumber(data.boatRect.encodeTs) ?? topEncodeTs,
        receivedAt: Date.now(),
      });
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
      }
      pushBuffer(planeBuf, {
        header: parseDetectionHeader(data.planeRect.header),
        videoRects: rects,
        videoWidth: vw,
        videoHeight: vh,
        frameId: toFiniteNumber(data.planeRect.frameId) ?? topFrameId,
        captureTs: toFiniteNumber(data.planeRect.captureTs) ?? topCaptureTs,
        encodeTs: toFiniteNumber(data.planeRect.encodeTs) ?? topEncodeTs,
        receivedAt: Date.now(),
      });
    }
  }
  if (data.singleRect) {
    const rects = extractVideoRectsFromLayer(data.singleRect);
    if (!_rectIdDiagDone && rects && rects.length > 0) {
      _rectIdDiagDone = true;
      const sampleRows = rects.slice(0, 3).map((r) => ({
        rowLen: r.length,
        xywh: r.slice(0, 4),
        fifth: r.length >= 5 ? r[4] : null,
      }));
      console.log("[eo-detect] rect id diag:", {
        layer: "singleRect",
        rows: rects.length,
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
    if (rects !== null) {
      if (rects.length === 0) {
        singleBuf.length = 0;
        cleared.clearedSingle = true;
      }
      pushBuffer(singleBuf, {
        header: parseDetectionHeader(data.singleRect.header),
        videoRects: rects,
        videoWidth: vw,
        videoHeight: vh,
        frameId: toFiniteNumber(data.singleRect.frameId) ?? topFrameId,
        captureTs: toFiniteNumber(data.singleRect.captureTs) ?? topCaptureTs,
        encodeTs: toFiniteNumber(data.singleRect.encodeTs) ?? topEncodeTs,
        receivedAt: Date.now(),
      });
    }
  }
  return cleared;
}
