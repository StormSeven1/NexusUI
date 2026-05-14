/**
 * 第三方相机 UDP 组播 1 分钟统计（与 `eo-third-party-camera-relay` 包头/组包/解码一致）。
 *
 * 用法:
 *   npx tsx scripts/eo-third-party-udp-minute-stats.ts [host] [port] [seconds]
 * 默认: 239.192.110.99 8568 60
 *
 * 指标说明:
 * - 总 UDP: 每个 datagram
 * - 完整 UDP 包: magic/类型合法且 msg.length >= HEADER_SIZE + dataLen（含心跳；`heartbeats` 单独计数）
 * - 不完整 UDP 包: 其余（过短、魔数不对、或声明长度超过实际报文）
 * - 完整视频帧: 单包或组包完成后 `processBinaryFramePayload` 成功
 * - 不完整视频帧: 采样结束时组包仍有缺片（按 sourceId 记账），或单包/整帧解码失败
 * - 每相机 UDP 包数: MSG_CAM_IMAGE_REPORT / MSG_DEV_STATUS_BASIC 且 UDP 完整时，状态包优先 JSON entityId，否则包头 sourceId
 * - 帧率: 完整视频帧数 / 采样时长
 */

import dgram from "node:dgram";

import { processBinaryFramePayload } from "../src/server/eo-third-party-camera-relay";

const HEADER_SIZE = 44;
const PROTOCOL_MAGIC = 0xeb90;
const MSG_DEV_HEARTBEAT = 0x1000;
const MSG_DEV_STATUS_BASIC = 0x1001;
const MSG_CAM_IMAGE_REPORT = 0x5001;

type ReassembleEntry = {
  totalPackets: number;
  packets: (Buffer | undefined)[];
  createTimeMs: number;
  sourceId: string;
  /** 首片 payload 前 16 字节实体名（与 relay `readEntityId` 一致），用于多片时按路统计 UDP */
  payloadEntityNorm: string;
};

/** 统一 `camera-hs-001` / `camera_hs_001` 等写法 */
function normCam(s: string): string {
  return s.trim().toLowerCase().replace(/-/g, "_");
}

/** 二进制图像 payload 头部实体 id（relay 同源） */
function readEntityId(buf: Buffer): string {
  const raw = buf.subarray(0, 16);
  const nz = raw.indexOf(0);
  const slice = nz >= 0 ? raw.subarray(0, nz) : raw;
  return slice.toString("utf8").trim().toLowerCase();
}

function readSourceIdFromUdpHeader(msg: Buffer): string {
  if (msg.length < 32) return "";
  const raw = msg.subarray(24, 32);
  const nz = raw.indexOf(0);
  const slice = nz >= 0 ? raw.subarray(0, nz) : raw;
  return slice.toString("utf8").trim().toLowerCase();
}

function bump(map: Map<string, number>, key: string, n = 1) {
  map.set(key, (map.get(key) ?? 0) + n);
}

function mapToSortedRecord(map: Map<string, number>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of [...map.keys()].sort()) o[k] = map.get(k) ?? 0;
  return o;
}

function main() {
  const host = process.argv[2] ?? "239.192.110.99";
  const port = Number(process.argv[3] ?? "8568") || 8568;
  const durationSec = Math.max(1, Number(process.argv[4] ?? "60") || 60);

  let totalUdp = 0;
  let udpComplete = 0;
  let udpIncomplete = 0;
  let heartbeats = 0;
  const byCameraUdp = new Map<string, number>();
  const fullFrames = new Map<string, number>();
  const incompleteFrames = new Map<string, number>();
  let decodeFailFrames = 0;

  const reasmMap = new Map<number, ReassembleEntry>();

  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });

  const onMessage = (msg: Buffer) => {
    totalUdp++;

    if (msg.length < HEADER_SIZE) {
      udpIncomplete++;
      return;
    }
    const magic = msg.readUInt16LE(0);
    if (magic !== PROTOCOL_MAGIC) {
      udpIncomplete++;
      return;
    }
    const msgType = msg.readUInt16LE(2);
    if (msgType === MSG_DEV_HEARTBEAT) {
      udpComplete++;
      heartbeats++;
      return;
    }

    const sequence = msg.readUInt32LE(4);
    const totalPackets = msg.readUInt16LE(8);
    const packetIndex = msg.readUInt16LE(10);
    const dataLen = msg.readUInt32LE(12);
    if (!Number.isFinite(dataLen) || dataLen < 0 || msg.length < HEADER_SIZE + dataLen) {
      udpIncomplete++;
      return;
    }
    udpComplete++;

    const payload = msg.subarray(HEADER_SIZE, HEADER_SIZE + dataLen);
    const src = readSourceIdFromUdpHeader(msg);

    const classifyStatusUdpKey = (): string => {
      try {
        const text = payload.toString("utf8").trim();
        const j = JSON.parse(text) as Record<string, unknown>;
        const fromJson = String(j.entityId ?? j.entity_id ?? "").trim().toLowerCase();
        return normCam(fromJson || src || "unknown");
      } catch {
        return normCam(src || "unknown");
      }
    };

    if (msgType === MSG_DEV_STATUS_BASIC) {
      bump(byCameraUdp, classifyStatusUdpKey());
    }

    if (msgType !== MSG_CAM_IMAGE_REPORT || dataLen === 0) return;

    const normSrc = normCam(src || "unknown");

    if (totalPackets <= 1) {
      const pe = payload.length >= 16 ? normCam(readEntityId(payload)) : "";
      bump(byCameraUdp, pe || normSrc);
      const frame = processBinaryFramePayload(Buffer.from(payload));
      if (frame) bump(fullFrames, normCam(frame.entityId || pe || src || "unknown"));
      else {
        decodeFailFrames++;
        bump(incompleteFrames, pe || normSrc);
      }
      return;
    }

    let e = reasmMap.get(sequence);
    if (!e) {
      e = {
        totalPackets,
        packets: new Array<Buffer | undefined>(totalPackets),
        createTimeMs: Date.now(),
        sourceId: src,
        payloadEntityNorm: "",
      };
      reasmMap.set(sequence, e);
    }
    if (packetIndex === 0 && payload.length >= 16) {
      const pe = normCam(readEntityId(payload));
      if (pe) e.payloadEntityNorm = pe;
    }
    bump(byCameraUdp, e.payloadEntityNorm || normSrc);

    if (packetIndex < e.packets.length) e.packets[packetIndex] = Buffer.from(payload);

    let complete = true;
    for (const pkt of e.packets) if (pkt === undefined || pkt.length === 0) complete = false;
    if (!complete) return;

    reasmMap.delete(sequence);
    const full = Buffer.concat(e.packets.filter((p): p is Buffer => p != null && p.length > 0));
    const frame = processBinaryFramePayload(full);
    const cam = normCam(frame?.entityId || e.payloadEntityNorm || e.sourceId || "unknown");
    if (frame) bump(fullFrames, cam);
    else {
      decodeFailFrames++;
      bump(incompleteFrames, cam);
    }
  };

  sock.on("message", onMessage);
  sock.on("error", (err) => {
    console.error("[udp-stats] socket error:", err.message);
  });

  const firstOctet = Number(host.split(".")[0]);
  const isMcast = firstOctet >= 224 && firstOctet <= 239;
  const bindAddr = isMcast ? "0.0.0.0" : host;

  const run = async () => {
    await new Promise<void>((resolve, reject) => {
      sock.once("error", reject);
      sock.bind(port, bindAddr, () => {
        try {
          if (isMcast) {
            sock.setMulticastLoopback(false);
            sock.addMembership(host);
          }
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        console.error(
          `[udp-stats] 监听 UDP *:${port} 组=${host}，采集 ${durationSec}s（Ctrl+C 可提前结束）…`,
        );
        resolve();
      });
    });

    const t0 = Date.now();
    await new Promise<void>((r) => setTimeout(r, durationSec * 1000));
    const elapsedSec = (Date.now() - t0) / 1000;

    sock.removeListener("message", onMessage);
    sock.close();

    let staleReasmSequences = 0;
    let staleReasmMissingSlots = 0;
    for (const [, e] of reasmMap) {
      const missing = e.packets.filter((p) => p === undefined || p.length === 0).length;
      if (missing > 0) {
        staleReasmSequences++;
        staleReasmMissingSlots += missing;
        bump(incompleteFrames, normCam(e.payloadEntityNorm || e.sourceId || "unknown"), missing);
      }
    }
    reasmMap.clear();

    const byUdp = mapToSortedRecord(byCameraUdp);
    const byFrames = mapToSortedRecord(fullFrames);
    const byIncomplete = mapToSortedRecord(incompleteFrames);

    const targetCams = ["camera_hs_001", "camera_hs_002", "camera_hs_003", "camera_hs_004"];
    const perTargetUdp: Record<string, number> = {};
    const perTargetFps: Record<string, number> = {};
    for (const id of targetCams) {
      perTargetUdp[id] = byCameraUdp.get(id) ?? 0;
      perTargetFps[id] = Math.round(((fullFrames.get(id) ?? 0) / elapsedSec) * 1000) / 1000;
    }

    const fps: Record<string, number> = {};
    for (const [k, v] of fullFrames) fps[k] = Math.round((v / elapsedSec) * 1000) / 1000;

    const report = {
      host,
      port,
      durationSecRequested: durationSec,
      elapsedSec: Math.round(elapsedSec * 1000) / 1000,
      totalUdpDatagrams: totalUdp,
      udpCompletePayloadOk: udpComplete,
      udpIncompleteOrNonProtocol: udpIncomplete,
      heartbeats,
      udpPerCameraImageOrStatus: byUdp,
      cameraHs001To004Udp: perTargetUdp,
      videoFramesComplete: byFrames,
      videoFrameDecodeFailures: decodeFailFrames,
      /** 解码失败 + 采样结束时仍未组完的缺片数（按相机 sourceId 累计缺片槽位数） */
      videoFramesIncompleteOrPartialReasm: byIncomplete,
      staleReassemblySequencesAtEnd: staleReasmSequences,
      staleReassemblyMissingSlotsAtEnd: staleReasmMissingSlots,
      videoFpsByCamera: fps,
      cameraHs001To004Fps: perTargetFps,
    };

    console.log(JSON.stringify(report, null, 2));
  };

  void run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
    try {
      sock.close();
    } catch {
      /* */
    }
  });
}

main();
