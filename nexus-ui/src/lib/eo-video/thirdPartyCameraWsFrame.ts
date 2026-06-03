/** 中继 → 浏览器二进制帧前缀 ASCII `NXT1` */
export const EO_THIRD_PARTY_WS_MAGIC = new Uint8Array([0x4e, 0x58, 0x54, 0x31]);

export type ThirdPartyCameraBox = { x: number; y: number; w: number; h: number };

export type ParsedThirdPartyWsFrame = {
  entityId: string;
  videoWidth: number;
  videoHeight: number;
  strideY: number;
  yuv420: Uint8Array;
  boxes: ThirdPartyCameraBox[];
};

export type ParseThirdPartyWsFrameOptions = {
  /**
   * 默认 true。地图/告警等仅需检测框时设 false，避免每帧 memcpy 整幅 YUV（会拖垮其它光电视频 WebRTC）。
   */
  copyYuv?: boolean;
};

export function parseThirdPartyWsFrame(
  buf: ArrayBuffer,
  options?: ParseThirdPartyWsFrameOptions,
): ParsedThirdPartyWsFrame | null {
  const u8 = new Uint8Array(buf);
  if (u8.byteLength < 20) return null;
  if (u8[0] !== 0x4e || u8[1] !== 0x58 || u8[2] !== 0x54 || u8[3] !== 0x31) return null;
  const dv = new DataView(buf);
  let o = 4;
  const entityLen = dv.getUint16(o, true);
  o += 2;
  if (o + entityLen > u8.byteLength) return null;
  const entityId = new TextDecoder("utf-8", { fatal: false }).decode(u8.subarray(o, o + entityLen));
  o += entityLen;
  if (o + 12 > u8.byteLength) return null;
  const videoWidth = dv.getUint32(o, true);
  o += 4;
  const videoHeight = dv.getUint32(o, true);
  o += 4;
  const strideY = dv.getUint32(o, true);
  o += 4;
  if (videoWidth < 1 || videoHeight < 1 || strideY < videoWidth || o + 2 > u8.byteLength) return null;
  const rectCount = dv.getUint16(o, true);
  o += 2;
  const boxes: ThirdPartyCameraBox[] = [];
  const rectBytes = rectCount * 16;
  if (o + rectBytes > u8.byteLength) return null;
  for (let i = 0; i < rectCount; i++) {
    const x = dv.getFloat32(o, true);
    o += 4;
    const y = dv.getFloat32(o, true);
    o += 4;
    const w = dv.getFloat32(o, true);
    o += 4;
    const h = dv.getFloat32(o, true);
    o += 4;
    boxes.push({ x, y, w, h });
  }
  if (o + 4 > u8.byteLength) return null;
  const yuvLen = dv.getUint32(o, true);
  o += 4;
  if (o + yuvLen > u8.byteLength || yuvLen < 1) return null;
  const yuv420 =
    options?.copyYuv === false
      ? new Uint8Array(buf, o, yuvLen)
      : new Uint8Array(buf, o, yuvLen).slice();
  return { entityId, videoWidth, videoHeight, strideY, yuv420, boxes };
}
