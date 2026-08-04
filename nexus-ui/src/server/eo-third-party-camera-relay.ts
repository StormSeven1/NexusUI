import dgram from "dgram";
import { decode as decodeJpeg } from "jpeg-js";
import { Worker } from "worker_threads";
import { WebSocket, WebSocketServer } from "ws";

import {
  EO_THIRD_PARTY_WS_MAGIC,
  type ThirdPartyCameraBox,
} from "@/lib/eo-video/thirdPartyCameraWsFrame";

// ──────────────────────────────────────────────────────────────────────────────
// Worker 内联代码：JPEG 解码（sharp）+ YUV 转换在独立线程执行，不阻塞事件循环。
// 使用 eval:true 避免 Next.js 打包时对 worker 文件路径的依赖。
// ──────────────────────────────────────────────────────────────────────────────
const WORKER_CODE = /* js */ `
const { parentPort } = require('worker_threads');

const BIN_DESC  = 74;
const RECT_SZ   = 24;
const WS_MAGIC  = Buffer.from([0x4e, 0x58, 0x54, 0x31]); // "NXT1"

let sharp;
try { sharp = require('sharp'); } catch {}

// BT.601 RGB24 → I420
function rgb24ToI420(rgb, w, h) {
  const ySize = w * h;
  const uvW = w >> 1, uvH = h >> 1, uvSize = uvW * uvH;
  const out = new Uint8Array(ySize + uvSize * 2);
  const Y = out, U = out.subarray(ySize, ySize + uvSize), V = out.subarray(ySize + uvSize);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = (row * w + col) * 3;
      const r = rgb[i] ?? 0, g = rgb[i+1] ?? 0, b = rgb[i+2] ?? 0;
      Y[row * w + col] = (77*r + 150*g + 29*b) >> 8;
    }
  }
  for (let by = 0; by < uvH; by++) {
    for (let bx = 0; bx < uvW; bx++) {
      let su = 0, sv = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = ((by*2+dy)*w + bx*2+dx) * 3;
        const r = rgb[i] ?? 0, g = rgb[i+1] ?? 0, b = rgb[i+2] ?? 0;
        su += ((-38*r - 74*g + 112*b) >> 8) + 128;
        sv += ((112*r - 94*g - 18*b) >> 8) + 128;
      }
      U[by*uvW+bx] = Math.min(255, Math.max(0, (su / 4) | 0));
      V[by*uvW+bx] = Math.min(255, Math.max(0, (sv / 4) | 0));
    }
  }
  return out;
}

function rgba32ToI420(rgba, w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let px = 0; px < w * h; px++) {
    rgb[px*3]   = rgba[px*4]   ?? 0;
    rgb[px*3+1] = rgba[px*4+1] ?? 0;
    rgb[px*3+2] = rgba[px*4+2] ?? 0;
  }
  return rgb24ToI420(rgb, w, h);
}

function compactI420FromStride(img, w, h, strideY) {
  const uvW = w >> 1, uvH = h >> 1;
  const out = new Uint8Array(w * h + uvW * uvH * 2);
  let o = 0;
  for (let r = 0; r < h; r++) { out.set(img.subarray(r*strideY, r*strideY+w), o); o += w; }
  const uOff = strideY * h, sUV = strideY >> 1, vOff = uOff + sUV * uvH;
  for (let r = 0; r < uvH; r++) { out.set(img.subarray(uOff+r*sUV, uOff+r*sUV+uvW), o); o += uvW; }
  for (let r = 0; r < uvH; r++) { out.set(img.subarray(vOff+r*sUV, vOff+r*sUV+uvW), o); o += uvW; }
  return out;
}

function rectsFromPayload(p, rectCount) {
  const boxes = [];
  for (let i = 0; i < rectCount; i++) {
    const ro = BIN_DESC + i * RECT_SZ;
    if (ro + RECT_SZ > p.length) break;
    boxes.push({ x: p.readFloatLE(ro+8), y: p.readFloatLE(ro+12), w: p.readFloatLE(ro+16), h: p.readFloatLE(ro+20) });
  }
  return boxes;
}

function readEntityId(buf) {
  const raw = buf.subarray(0, 16);
  const nz = raw.indexOf(0);
  return (nz >= 0 ? raw.subarray(0, nz) : raw).toString('utf8').trim().toLowerCase();
}

async function processPayload(payload) {
  if (payload.length < BIN_DESC) return null;
  const w = payload.readUInt16LE(28), h = payload.readUInt16LE(30);
  const imageSize = payload.readUInt32LE(24), rectCount = payload.readUInt16LE(70);
  if (w === 0 || h === 0) return null;
  const rectsBytes = rectCount * RECT_SZ;
  const imageOffset = BIN_DESC + rectsBytes;
  const avail = payload.length - imageOffset;
  if (avail <= 0) return null;
  const boxes = rectsFromPayload(payload, rectCount);
  const imgSlice = payload.subarray(imageOffset, imageOffset + Math.min(avail, imageSize));
  const expectedYuv = (w * h * 3) >> 1;

  let strideY = w;
  if (h > 0 && imageSize > expectedYuv) {
    const c = Math.floor(((imageSize * 2) / (3 * h)) | 0);
    if (c >= w && c <= w + 128) strideY = c;
  }
  const fullStrideYuv = strideY * h + 2 * (strideY >> 1) * (h >> 1);

  let compact = null;

  if (strideY > w && imgSlice.byteLength >= fullStrideYuv) {
    compact = compactI420FromStride(imgSlice, w, h, strideY);
  } else if (imageSize === expectedYuv && imgSlice.byteLength >= expectedYuv) {
    compact = Uint8Array.prototype.slice.call(imgSlice, 0, expectedYuv);
  } else if (expectedYuv > 0 && imageSize >= expectedYuv && imageSize <= expectedYuv + 1024 && imgSlice.byteLength >= expectedYuv) {
    compact = Uint8Array.prototype.slice.call(imgSlice, 0, expectedYuv);
  } else if (expectedYuv > 0 && avail >= expectedYuv - 16) {
    const copyLen = Math.min(expectedYuv, avail);
    compact = new Uint8Array(expectedYuv);
    compact.set(imgSlice.subarray(0, copyLen), 0);
    compact.fill(0x80, copyLen);
  } else if (imageSize === w * h * 3 && avail >= w * h * 3) {
    compact = rgb24ToI420(imgSlice.subarray(0, w * h * 3), w, h);
  } else if (imageSize === w * h * 4 && avail >= w * h * 4) {
    compact = rgba32ToI420(imgSlice.subarray(0, w * h * 4), w, h);
  } else {
    // JPEG 解码：优先 sharp（libjpeg-turbo），回退 jpeg-js
    let jpegRgba = null, jw = w, jh = h;
    if (sharp) {
      try {
        const { data, info } = await sharp(Buffer.from(imgSlice)).raw().toBuffer({ resolveWithObject: true });
        jpegRgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        jw = info.width; jh = info.height;
      } catch {}
    }
    if (!jpegRgba) {
      try {
        const jpeg = require('jpeg-js');
        const j = jpeg.decode(Buffer.from(imgSlice), { useTArray: true });
        if (j.width > 0 && j.height > 0 && j.data?.length >= j.width * j.height * 4) {
          jpegRgba = new Uint8Array(j.data); jw = j.width; jh = j.height;
        }
      } catch {}
    }
    if (!jpegRgba) return null;
    compact = rgba32ToI420(jpegRgba, jw, jh);
    return compact ? { entityId: readEntityId(payload), compact, w: jw, h: jh, strideY: jw, boxes } : null;
  }

  if (!compact) return null;
  return { entityId: readEntityId(payload), compact, w, h, strideY: w, boxes };
}

function encodeFrame(f) {
  const entityBuf = Buffer.from(f.entityId, 'utf8');
  const elen = Math.min(65535, entityBuf.length);
  const rects = f.boxes;
  const sz = 4 + 2 + elen + 4 + 4 + 4 + 2 + rects.length * 16 + 4 + f.compact.byteLength;
  const out = Buffer.allocUnsafe(sz);
  let o = 0;
  WS_MAGIC.copy(out, o); o += 4;
  out.writeUInt16LE(elen, o); o += 2;
  entityBuf.copy(out, o, 0, elen); o += elen;
  out.writeUInt32LE(f.w >>> 0, o); o += 4;
  out.writeUInt32LE(f.h >>> 0, o); o += 4;
  out.writeUInt32LE(f.strideY >>> 0, o); o += 4;
  out.writeUInt16LE(rects.length >>> 0, o); o += 2;
  for (const r of rects) {
    out.writeFloatLE(r.x, o); o += 4;
    out.writeFloatLE(r.y, o); o += 4;
    out.writeFloatLE(r.w, o); o += 4;
    out.writeFloatLE(r.h, o); o += 4;
  }
  out.writeUInt32LE(f.compact.byteLength >>> 0, o); o += 4;
  Buffer.from(f.compact.buffer, f.compact.byteOffset, f.compact.byteLength).copy(out, o);
  return out;
}

parentPort.on('message', async ({ id, payload }) => {
  try {
    const frame = await processPayload(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
    if (!frame) { parentPort.postMessage({ id, buf: null }); return; }
    const buf = encodeFrame(frame);
    // 必须拷贝后再 transfer，否则可能 detach Node Buffer 底层 pool
    const out = Buffer.from(buf);
    parentPort.postMessage({ id, buf: out }, [out.buffer]);
  } catch (e) {
    parentPort.postMessage({ id, buf: null });
  }
});
`;

const HEADER_SIZE = 44;
const PROTOCOL_MAGIC = 0xeb90;
const MSG_DEV_HEARTBEAT = 0x1000;
const MSG_DEV_STATUS_BASIC = 0x1001;
const MSG_CAM_IMAGE_REPORT = 0x5001;
const BIN_DESC = 74;
const RECT_SZ = 24;
const REASSEMBLE_TIMEOUT_MS = 10_000;

type ReassembleEntry = {
  totalPackets: number;
  packets: (Buffer | undefined)[];
  createTimeMs: number;
};

let relayStarted = false;

function parseMulticastUdp(raw: string): { host: string; port: number } | null {
  const t = raw.trim();
  const idx = t.lastIndexOf(":");
  if (idx <= 0) return null;
  const host = t.slice(0, idx).trim();
  const port = Number(t.slice(idx + 1).trim());
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

function readEntityId(buf: Buffer): string {
  const raw = buf.subarray(0, 16);
  const nz = raw.indexOf(0);
  const slice = nz >= 0 ? raw.subarray(0, nz) : raw;
  return slice.toString("utf8").trim().toLowerCase();
}

/** UDP 包头 `sourceId` 8 字节（与 `highspeedcameraprotocol.h` 一致） */
function readSourceIdFromUdpHeader(msg: Buffer): string {
  if (msg.length < 32) return "";
  const raw = msg.subarray(24, 32);
  const nz = raw.indexOf(0);
  const slice = nz >= 0 ? raw.subarray(0, nz) : raw;
  return slice.toString("utf8").trim().toLowerCase();
}

/** BT.601，与演示 `imageToYuv420P` 一致 */
export function rgb24ToI420(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const ySize = width * height;
  const uvW = width >> 1;
  const uvH = height >> 1;
  const uvSize = uvW * uvH;
  const out = new Uint8Array(ySize + uvSize * 2);
  const Y = out;
  const U = out.subarray(ySize, ySize + uvSize);
  const V = out.subarray(ySize + uvSize);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 3;
      const r = rgb[i] ?? 0;
      const g = rgb[i + 1] ?? 0;
      const b = rgb[i + 2] ?? 0;
      const yy = (77 * r + 150 * g + 29 * b) >> 8;
      Y[row * width + col] = yy & 255;
    }
  }
  for (let by = 0; by < uvH; by++) {
    for (let bx = 0; bx < uvW; bx++) {
      let su = 0;
      let sv = 0;
      let n = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const row = by * 2 + dy;
          const col = bx * 2 + dx;
          const i = (row * width + col) * 3;
          const r = rgb[i] ?? 0;
          const g = rgb[i + 1] ?? 0;
          const b = rgb[i + 2] ?? 0;
          su += ((-38 * r - 74 * g + 112 * b) >> 8) + 128;
          sv += ((112 * r - 94 * g - 18 * b) >> 8) + 128;
          n++;
        }
      }
      U[by * uvW + bx] = Math.min(255, Math.max(0, (su / n) | 0));
      V[by * uvW + bx] = Math.min(255, Math.max(0, (sv / n) | 0));
    }
  }
  return out;
}

function rgbaToI420(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let px = 0; px < width * height; px++) {
    const i = px * 4;
    rgb[px * 3] = rgba[i] ?? 0;
    rgb[px * 3 + 1] = rgba[i + 1] ?? 0;
    rgb[px * 3 + 2] = rgba[i + 2] ?? 0;
  }
  return rgb24ToI420(rgb, width, height);
}

function compactI420FromStride(img: Uint8Array, width: number, height: number, strideY: number): Uint8Array {
  const ySize = width * height;
  const uvW = width >> 1;
  const uvH = height >> 1;
  const uvPlane = uvW * uvH;
  const out = new Uint8Array(ySize + uvPlane * 2);
  let o = 0;
  for (let r = 0; r < height; r++) {
    const rowOff = r * strideY;
    out.set(img.subarray(rowOff, rowOff + width), o);
    o += width;
  }
  const uOff = strideY * height;
  const sUV = strideY >> 1;
  const vOff = uOff + sUV * uvH;
  for (let r = 0; r < uvH; r++) {
    out.set(img.subarray(uOff + r * sUV, uOff + r * sUV + uvW), o);
    o += uvW;
  }
  for (let r = 0; r < uvH; r++) {
    out.set(img.subarray(vOff + r * sUV, vOff + r * sUV + uvW), o);
    o += uvW;
  }
  return out;
}

function rectsFromPayload(p: Buffer, rectCount: number): ThirdPartyCameraBox[] {
  const boxes: ThirdPartyCameraBox[] = [];
  for (let i = 0; i < rectCount; i++) {
    const ro = BIN_DESC + i * RECT_SZ;
    if (ro + RECT_SZ > p.length) break;
    const x = p.readFloatLE(ro + 8);
    const y = p.readFloatLE(ro + 12);
    const w = p.readFloatLE(ro + 16);
    const h = p.readFloatLE(ro + 20);
    boxes.push({ x, y, w, h });
  }
  return boxes;
}

/** 供独立统计脚本等与 relay 完全一致的帧解析校验 */
export function processBinaryFramePayload(payload: Buffer): {
  entityId: string;
  compact: Uint8Array;
  w: number;
  h: number;
  strideY: number;
  boxes: ThirdPartyCameraBox[];
} | null {
  if (payload.length < BIN_DESC) return null;
  const w = payload.readUInt16LE(28);
  const h = payload.readUInt16LE(30);
  const imageSize = payload.readUInt32LE(24);
  const rectCount = payload.readUInt16LE(70);
  if (w === 0 || h === 0) return null;
  const rectsBytes = rectCount * RECT_SZ;
  const imageOffset = BIN_DESC + rectsBytes;
  const avail = payload.length - imageOffset;
  if (avail <= 0) return null;
  const boxes = rectsFromPayload(payload, rectCount);
  const imgSlice = payload.subarray(imageOffset, imageOffset + Math.min(avail, imageSize));

  const expectedYuv420P = (w * h * 3) >> 1;
  let strideY = w;
  if (h > 0 && imageSize > expectedYuv420P) {
    const computed = Math.floor(((imageSize * 2) / (3 * h)) | 0);
    if (computed >= w && computed <= w + 128) strideY = computed;
  }
  const fullStrideYuv = strideY * h + 2 * (strideY >> 1) * (h >> 1);

  let compact: Uint8Array | null = null;

  if (strideY > w && imgSlice.byteLength >= fullStrideYuv) {
    compact = compactI420FromStride(imgSlice, w, h, strideY);
  } else if (imageSize === expectedYuv420P && imgSlice.byteLength >= expectedYuv420P) {
    compact = Uint8Array.prototype.slice.call(imgSlice, 0, expectedYuv420P);
  } else if (
    expectedYuv420P > 0 &&
    imageSize >= expectedYuv420P &&
    imageSize <= expectedYuv420P + 1024 &&
    imgSlice.byteLength >= expectedYuv420P
  ) {
    compact = Uint8Array.prototype.slice.call(imgSlice, 0, expectedYuv420P);
  } else if (expectedYuv420P > 0 && avail >= expectedYuv420P - 16) {
    const copyLen = Math.min(expectedYuv420P, avail);
    compact = new Uint8Array(expectedYuv420P);
    compact.set(imgSlice.subarray(0, copyLen), 0);
    compact.fill(0x80, copyLen);
  } else if (imageSize === w * h * 3 && avail >= w * h * 3) {
    compact = rgb24ToI420(imgSlice.subarray(0, w * h * 3), w, h);
  } else if (imageSize === w * h * 4 && avail >= w * h * 4) {
    compact = rgbaToI420(imgSlice.subarray(0, w * h * 4), w, h);
  } else {
    try {
      const j = decodeJpeg(Buffer.from(imgSlice), { useTArray: true });
      const jw = j.width ?? 0;
      const jh = j.height ?? 0;
      if (jw > 0 && jh > 0 && j.data != null && j.data.length >= jw * jh * 4) {
        compact = rgbaToI420(new Uint8Array(j.data as ArrayLike<number>), jw, jh);
        return compact
          ? {
              entityId: readEntityId(payload),
              compact,
              w: jw,
              h: jh,
              strideY: jw,
              boxes,
            }
          : null;
      }
    } catch {
      /* 非 JPEG */
    }
    return null;
  }

  if (!compact) return null;
  const entityId = readEntityId(payload);
  return { entityId, compact, w, h, strideY: w, boxes };
}

function encodeWsFrame(parts: {
  entityId: string;
  compact: Uint8Array;
  w: number;
  h: number;
  strideY: number;
  boxes: ThirdPartyCameraBox[];
}): Buffer {
  const entityBuf = Buffer.from(parts.entityId, "utf8");
  const elen = Math.min(65535, entityBuf.length);
  const rects = parts.boxes;
  const hdr =
    4 +
    2 +
    elen +
    4 +
    4 +
    4 +
    2 +
    rects.length * 16 +
    4 +
    parts.compact.byteLength;
  const out = Buffer.allocUnsafe(hdr);
  let o = 0;
  Buffer.from(EO_THIRD_PARTY_WS_MAGIC).copy(out, o);
  o += 4;
  out.writeUInt16LE(elen, o);
  o += 2;
  entityBuf.copy(out, o, 0, elen);
  o += elen;
  out.writeUInt32LE(parts.w >>> 0, o);
  o += 4;
  out.writeUInt32LE(parts.h >>> 0, o);
  o += 4;
  out.writeUInt32LE(parts.strideY >>> 0, o);
  o += 4;
  out.writeUInt16LE(rects.length >>> 0, o);
  o += 2;
  for (const r of rects) {
    out.writeFloatLE(r.x, o);
    o += 4;
    out.writeFloatLE(r.y, o);
    o += 4;
    out.writeFloatLE(r.w, o);
    o += 4;
    out.writeFloatLE(r.h, o);
    o += 4;
  }
  out.writeUInt32LE(parts.compact.byteLength >>> 0, o);
  o += 4;
  Buffer.from(parts.compact.buffer, parts.compact.byteOffset, parts.compact.byteLength).copy(out, o);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Worker 池：N 个线程并行处理多路相机图像帧，主线程不再同步阻塞。
// ──────────────────────────────────────────────────────────────────────────────
const WORKER_POOL_SIZE = Number(process.env.EO_THIRD_PARTY_RELAY_WORKERS ?? "4") || 4;

type WorkerState = {
  worker: Worker;
  busy: boolean;
};

function createWorkerPool(size: number): WorkerState[] {
  const pool: WorkerState[] = [];
  for (let i = 0; i < size; i++) {
    pool.push({ worker: new Worker(WORKER_CODE, { eval: true }), busy: false });
  }
  return pool;
}

function pickFreeWorker(pool: WorkerState[]): WorkerState | null {
  return pool.find((w) => !w.busy) ?? null;
}

export function startEoThirdPartyCameraRelay(): void {
  if (relayStarted) return;
  if (process.env.EO_THIRD_PARTY_CAMERA_RELAY === "0") return;
  /** 无网卡/无组播的 Serverless 宿主上不要起 UDP（仅本地 / 自建 Node 启用） */
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;

  const raw =
    process.env.EO_THIRD_PARTY_CAMERA_MULTICAST_UDP?.trim() ||
    process.env.NEXT_PUBLIC_EO_THIRD_PARTY_CAMERA_MULTICAST_UDP?.trim();

  const parsed = raw ? parseMulticastUdp(raw) : null;
  if (!parsed) return;

  const wsPort = Number(process.env.EO_THIRD_PARTY_CAMERA_WS_PORT ?? "40777") || 40777;
  let wss: WebSocketServer;
  try {
    wss = new WebSocketServer({ port: wsPort, host: "0.0.0.0" });
  } catch {
    console.error("[eo-third-party-relay] WebSocket bind failed:", wsPort);
    return;
  }
  wss.on("error", (err) => {
    console.error("[eo-third-party-relay] WS server error:", err.message);
  });

  const sockets = new Set<WebSocket>();
  const reasmMap = new Map<number, ReassembleEntry>();

  // 每路相机：是否有帧正在 worker 中处理；忙时只保留最新一帧，避免某路被长期饿死
  const cameraInFlight = new Set<string>();
  const cameraPending = new Map<string, Buffer>();

  /**
   * 慢客户端背压：单连接发送队列超过阈值则跳过本帧（只影响该客户端）。
   * 否则 TCP/WS 缓冲会无限堆旧帧 → 两台同开 21911 时，慢机延迟越来越大。
   * 默认 512KiB（约 4~5 帧 320×240 I420）；可用 EO_THIRD_PARTY_WS_MAX_BUFFERED 覆盖。
   */
  const WS_MAX_BUFFERED =
    Number(process.env.EO_THIRD_PARTY_WS_MAX_BUFFERED ?? String(512 * 1024)) || 512 * 1024;
  let wsDropLogMs = 0;
  let wsDropCount = 0;

  function sendBinaryToClients(encoded: Buffer): void {
    for (const c of sockets) {
      if (c.readyState !== WebSocket.OPEN) continue;
      if (c.bufferedAmount > WS_MAX_BUFFERED) {
        wsDropCount++;
        const now = Date.now();
        if (now - wsDropLogMs > 5000) {
          wsDropLogMs = now;
          console.warn(
            `[eo-third-party-relay] WS backpressure: dropped ${wsDropCount} frame(s) ` +
              `(bufferedAmount>${WS_MAX_BUFFERED}, clients=${sockets.size})`,
          );
          wsDropCount = 0;
        }
        continue;
      }
      try {
        c.send(encoded);
      } catch {
        /* 连接半关闭等，等 onclose 清理 */
      }
    }
  }

  function sendTextToClients(text: string): void {
    // 状态包很小；仍对严重积压客户端跳过，避免拖大其队列
    const statusCap = Math.max(WS_MAX_BUFFERED * 2, 1024 * 1024);
    for (const c of sockets) {
      if (c.readyState !== WebSocket.OPEN) continue;
      if (c.bufferedAmount > statusCap) continue;
      try {
        c.send(text);
      } catch {
        /* ignore */
      }
    }
  }

  const pruneStale = () => {
    const now = Date.now();
    for (const [k, e] of reasmMap) {
      if (now - e.createTimeMs > REASSEMBLE_TIMEOUT_MS) reasmMap.delete(k);
    }
  };
  setInterval(pruneStale, 2000);

  // 创建 worker 池（JPEG decode + YUV 转换在独立线程，不阻塞 Next.js 事件循环）
  const pool = createWorkerPool(WORKER_POOL_SIZE);
  console.log(
    `[eo-third-party-relay] worker pool size=${WORKER_POOL_SIZE} wsMaxBuffered=${WS_MAX_BUFFERED}`,
  );

  /** 将完整帧 payload 分发到空闲 worker；本路忙时覆盖 pending，worker 空闲后补发 */
  function dispatchToWorker(entityId: string, fullPayload: Buffer): void {
    if (cameraInFlight.has(entityId)) {
      cameraPending.set(entityId, fullPayload);
      return;
    }
    const ws = pickFreeWorker(pool);
    if (!ws) {
      cameraPending.set(entityId, fullPayload);
      return;
    }

    ws.busy = true;
    cameraInFlight.add(entityId);

    // 拷贝一份再 transfer，避免共享 Buffer pool 的 ArrayBuffer 被 detach
    const copy = Buffer.from(fullPayload);
    const ab = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer;

    const finish = () => {
      ws.busy = false;
      cameraInFlight.delete(entityId);
      const pending = cameraPending.get(entityId);
      if (pending) {
        cameraPending.delete(entityId);
        // 下一 tick 再派，避免同栈重入把同一 worker 再次占满
        setImmediate(() => dispatchToWorker(entityId, pending));
      }
    };

    const onMessage = (msg: { id: string; buf: Buffer | ArrayBuffer | null }) => {
      ws.worker.off("message", onMessage);
      ws.worker.off("error", onError);
      try {
        if (msg.buf) {
          const encoded = Buffer.isBuffer(msg.buf) ? msg.buf : Buffer.from(msg.buf);
          sendBinaryToClients(encoded);
        }
      } finally {
        finish();
      }
    };
    const onError = (err: Error) => {
      ws.worker.off("message", onMessage);
      ws.worker.off("error", onError);
      console.error("[eo-third-party-relay] worker error:", err.message);
      finish();
    };

    ws.worker.on("message", onMessage);
    ws.worker.on("error", onError);
    ws.worker.postMessage({ id: entityId, payload: ab }, [ab]);
  }

  /** 从 payload 快速读取 entityId（主线程轻量操作，用于 in-flight 判断） */
  function peekEntityId(payload: Buffer): string {
    const raw = payload.subarray(0, 16);
    const nz = raw.indexOf(0);
    return (nz >= 0 ? raw.subarray(0, nz) : raw).toString("utf8").trim().toLowerCase();
  }

  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("error", (err) => {
    console.error("[eo-third-party-relay] UDP socket error:", err.message);
  });

  const firstOctet = Number(parsed.host.split(".")[0]);
  const isMcast = firstOctet >= 224 && firstOctet <= 239;
  const bindAddr = isMcast ? "0.0.0.0" : parsed.host;
  sock.bind(parsed.port, bindAddr, () => {
    try {
      if (isMcast) {
        sock.setMulticastLoopback(false);
        sock.addMembership(parsed.host);
      }
    } catch (e) {
      console.warn("[eo-third-party-relay] multicast join:", e instanceof Error ? e.message : String(e));
    }
  });

  relayStarted = true;
  console.log(
    `[eo-third-party-relay] UDP *:${parsed.port} group=${parsed.host} → ws://0.0.0.0:${wsPort}`,
  );

  sock.on("message", (msg: Buffer) => {
    pruneStale();
    if (msg.length < HEADER_SIZE) return;
    const magic = msg.readUInt16LE(0);
    if (magic !== PROTOCOL_MAGIC) return;
    const msgType = msg.readUInt16LE(2);
    if (msgType === MSG_DEV_HEARTBEAT) return;

    const sequence = msg.readUInt32LE(4);
    const totalPackets = msg.readUInt16LE(8);
    const packetIndex = msg.readUInt16LE(10);
    const dataLen = msg.readUInt32LE(12);
    if (!Number.isFinite(dataLen) || dataLen < 0 || msg.length < HEADER_SIZE + dataLen) return;
    const payload = msg.subarray(HEADER_SIZE, HEADER_SIZE + dataLen);

    // 0x1001：设备状态 JSON，轻量，主线程直接处理
    if (msgType === MSG_DEV_STATUS_BASIC) {
      if (dataLen === 0) return;
      const text = payload.toString("utf8").trim();
      let parsedJson: Record<string, unknown>;
      try {
        const j = JSON.parse(text) as unknown;
        if (!j || typeof j !== "object" || Array.isArray(j)) return;
        parsedJson = j as Record<string, unknown>;
      } catch {
        return;
      }
      const src = readSourceIdFromUdpHeader(msg);
      const fromJson = String(parsedJson.entityId ?? parsedJson.entity_id ?? "").trim().toLowerCase();
      const entityId = fromJson || src;
      const envelope = JSON.stringify({
        ...parsedJson,
        kind: "thirdPartyDevStatusBasic",
        entityId: entityId || fromJson || src,
        sequence,
      });
      sendTextToClients(envelope);
      return;
    }

    // 0x5001：图像帧，送入 worker 线程处理（JPEG decode + YUV + encode）
    if (msgType !== MSG_CAM_IMAGE_REPORT) return;
    if (dataLen === 0) return;

    if (totalPackets <= 1) {
      // 单包帧：直接分派
      const entityId = peekEntityId(payload);
      dispatchToWorker(entityId, Buffer.from(payload));
      return;
    }

    // 多包帧：重组后分派
    let e = reasmMap.get(sequence);
    const now = Date.now();
    if (!e) {
      e = { totalPackets, packets: new Array<Buffer | undefined>(totalPackets), createTimeMs: now };
      reasmMap.set(sequence, e);
    }
    if (packetIndex < e.packets.length) e.packets[packetIndex] = Buffer.from(payload);

    for (const pkt of e.packets) if (pkt === undefined || pkt.length === 0) return; // 未完整

    reasmMap.delete(sequence);
    const full = Buffer.concat(e.packets.filter((p): p is Buffer => p != null && p.length > 0));
    const entityId = peekEntityId(full);
    dispatchToWorker(entityId, full);
  });

  wss.on("connection", (ws) => {
    sockets.add(ws);
    ws.on("close", () => sockets.delete(ws));
  });
}
