import { rewriteSignalingUrlForBrowser } from "./zlmProxyUrl";

const DEFAULT_BASE = "http://192.168.18.141:91";

/**
 * 无人机 WebRTC：ZLM 管理端口（宿主机映射，如 docker-compose 91:80）。
 * 与现场约定：`app=live`，`stream=livestream/<机场或机体 SN>-<payload>`，例如
 * `livestream/7CTDM7D00BP0G0-165-0-7`（机场 FPV）。
 */
export function getUavZlmWebrtcBaseUrl(): string {
  const fromEnv =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_NEXUS_UAV_ZLM_WEBRTC_BASE_URL?.trim()) ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_UAV_ZLM_WEBRTC_BASE?.trim());
  return (fromEnv || DEFAULT_BASE).replace(/\/$/, "");
}

/** ZLM stream 名：`livestream/<SN>-<payload>`，payload 与原生端 payload_index 一致（如 165-0-7） */
export function buildUavZlmStreamKey(deviceOrAirportSn: string, payloadIndex: string): string {
  const sn = deviceOrAirportSn.trim();
  const payload = payloadIndex.trim().replace(/\//g, "-");
  if (!sn) throw new Error("UAV ZLM: 空 SN");
  if (!payload) throw new Error("UAV ZLM: 空 payload");
  return `livestream/${sn}-${payload}`;
}

export function buildUavZlmSignalingUrl(deviceOrAirportSn: string, payloadIndex: string): string {
  const base = getUavZlmWebrtcBaseUrl();
  const stream = buildUavZlmStreamKey(deviceOrAirportSn, payloadIndex);
  const q = new URLSearchParams({ app: "live", stream, type: "play" });
  const abs = `${base}/index/api/webrtc?${q.toString()}`;
  return rewriteSignalingUrlForBrowser(abs);
}
