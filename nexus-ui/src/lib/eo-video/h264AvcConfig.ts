/** 从 WebRTC AVCC 编码帧（4 字节大端长度 + NAL）解析 NAL 单元 */
export function parseAvccNalUnits(data: ArrayBuffer): Uint8Array[] {
  const view = new DataView(data);
  const nals: Uint8Array[] = [];
  let offset = 0;
  while (offset + 4 <= data.byteLength) {
    const len = view.getUint32(offset, false);
    offset += 4;
    if (len <= 0 || offset + len > data.byteLength) break;
    nals.push(new Uint8Array(data, offset, len));
    offset += len;
  }
  if (nals.length > 0) return nals;

  /** Annex-B 兜底（0x00000001） */
  const bytes = new Uint8Array(data);
  let i = 0;
  while (i + 4 <= bytes.length) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      i += 3;
    } else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) {
      i += 4;
    } else {
      i++;
      continue;
    }
    const start = i;
    while (i + 3 <= bytes.length) {
      if (
        (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) ||
        (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1)
      ) {
        break;
      }
      i++;
    }
    if (i > start) nals.push(bytes.subarray(start, i));
  }
  return nals;
}

/** 从 IDR 关键帧 NAL 列表构建 WebCodecs `description`（avcC） */
export function buildAvcCFromKeyFrame(data: ArrayBuffer): Uint8Array | null {
  const nals = parseAvccNalUnits(data);
  let sps: Uint8Array | null = null;
  let pps: Uint8Array | null = null;
  for (const nal of nals) {
    if (nal.length < 1) continue;
    const type = nal[0]! & 0x1f;
    if (type === 7) sps = nal;
    if (type === 8) pps = nal;
  }
  if (!sps || !pps || sps.length < 4) return null;

  const avcC = new Uint8Array(11 + sps.length + pps.length);
  avcC[0] = 1;
  avcC[1] = sps[1]!;
  avcC[2] = sps[2]!;
  avcC[3] = sps[3]!;
  avcC[4] = 0xff;
  avcC[5] = 0xe1;
  avcC[6] = (sps.length >> 8) & 0xff;
  avcC[7] = sps.length & 0xff;
  avcC.set(sps, 8);
  let o = 8 + sps.length;
  avcC[o] = 1;
  o += 1;
  avcC[o] = (pps.length >> 8) & 0xff;
  avcC[o + 1] = pps.length & 0xff;
  avcC.set(pps, o + 2);
  return avcC;
}
