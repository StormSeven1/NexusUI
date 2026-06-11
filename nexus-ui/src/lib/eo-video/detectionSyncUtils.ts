import type { EoDetectionBox } from "@/lib/eo-video/types";

/**
 * 检测框同步工具。
 *
 * 这个文件是 EO 检测框链路里的“格式统一层”。
 * 它不负责收消息，也不负责播放视频，而是专门负责把不同来源的数据整理成统一格式。
 *
 * 主要解决两类问题：
 * 1. `syncHeader` 统一
 *    - 后端检测消息里的同步头格式可能是数组、字符串、ArrayBuffer
 *    - WebRTC 编码帧提取出来的同步头也是二进制
 *    - 这里统一归一化成 `Uint8Array`，供同步比较使用
 *
 * 2. `rects -> EoDetectionBox` 统一
 *    - 后端框坐标可能已经是 0..1，也可能仍然是像素坐标
 *    - 这里统一转成覆盖层使用的 0..1 相对坐标
 *
 * 调用关系：
 * - `EoVideoViewport` 内联的播放逻辑 / `eoWebrtcEncodedSync.ts` 会用到同步头提取工具
 * - `useEoSyncedDetections` 会用到同步头比较和框坐标转换
 */

const HEADER_LEN = 32;

export function parseDetectionHeader(headerData: unknown): Uint8Array | null {
  if (headerData == null) return null;
  if (headerData instanceof Uint8Array) return headerData.byteLength ? headerData : null;
  if (Array.isArray(headerData)) {
    return new Uint8Array(headerData.map((value) => Number(value) & 0xff));
  }
  if (typeof headerData === "object" && headerData !== null && !(headerData instanceof ArrayBuffer)) {
    const record = headerData as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) {
      const bytes = new Uint8Array(keys.length);
      for (let i = 0; i < keys.length; i += 1) {
        bytes[i] = Number(record[keys[i]!]) & 0xff;
      }
      return bytes.byteLength ? bytes : null;
    }
  }
  if (headerData instanceof ArrayBuffer) {
    return new Uint8Array(headerData);
  }
  if (typeof headerData === "string") {
    const text = headerData.trim();
    if (!text) return null;
    const cleanHex = text.replace(/^0x/i, "").replace(/\s+/g, "");
    if (/^[0-9a-fA-F]+$/.test(cleanHex) && cleanHex.length >= 8) {
      const hex = cleanHex.length % 2 === 0 ? cleanHex : `0${cleanHex}`;
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
      }
      return bytes;
    }
  }
  return null;
}

export function headersMatch(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b) return false;
  if (a.length === b.length) {
    return a.every((value, index) => value === b[index]);
  }
  if (Math.min(a.length, b.length) < HEADER_LEN) return false;
  for (let i = 0; i < HEADER_LEN; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function createSyncHeaderFromEncodedFrame(encoded: {
  data: ArrayBuffer | ArrayBufferView;
  timestamp?: number;
}): Uint8Array {
  const source =
    encoded.data instanceof ArrayBuffer
      ? new Uint8Array(encoded.data)
      : new Uint8Array(encoded.data.buffer, encoded.data.byteOffset, encoded.data.byteLength);
  const header = new Uint8Array(HEADER_LEN);
  const size = source.byteLength >>> 0;
  header[0] = (size >>> 24) & 0xff;
  header[1] = (size >>> 16) & 0xff;
  header[2] = (size >>> 8) & 0xff;
  header[3] = size & 0xff;
  for (let i = 0; i < HEADER_LEN - 4; i += 1) {
    header[i + 4] = source[i + 4] ?? 0;
  }
  return header;
}

function classLabelFromClassId(classId: number | null | undefined): string | undefined {
  if (!Number.isFinite(classId)) return undefined;
  switch (Number(classId)) {
    case 1:
      return "鸟";
    case 2:
      return "飞机";
    case 4:
      return "船";
    case 5:
      return "浮标";
    default:
      return `类型 ${Number(classId)}`;
  }
}

function rectsLookNormalized(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): boolean {
  if (!rects.length) return false;
  return rects.every((row) =>
    [row.x, row.y, row.width, row.height].every((value) => value >= -0.001 && value <= 1.001),
  );
}

export function detectionRectsToEoBoxes(
  rects: Array<{ x: number; y: number; width: number; height: number; boxId: number; classId: number | null }>,
  videoWidth: number,
  videoHeight: number,
  idPrefix: string,
  colorToken: EoDetectionBox["colorToken"] = "accent",
): EoDetectionBox[] {
  if (!rects.length) return [];
  const normalized = rectsLookNormalized(rects);
  if (!normalized && (!videoWidth || !videoHeight)) return [];
  return rects.flatMap((rect, index) => {
    if (!rect) return [];
    const { x, y, width: w, height: h, boxId, classId } = rect;
    if (w <= 0 || h <= 0) return [];
    return [{
      id: `${idPrefix}-${boxId ?? index}`,
      label: classLabelFromClassId(classId),
      classId,
      colorToken,
      x: normalized ? x : x / videoWidth,
      y: normalized ? y : y / videoHeight,
      w: normalized ? w : w / videoWidth,
      h: normalized ? h : h / videoHeight,
    }];
  });
}
