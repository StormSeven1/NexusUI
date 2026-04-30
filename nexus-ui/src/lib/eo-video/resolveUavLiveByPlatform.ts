import { buildUavZlmSignalingUrl } from "./buildUavZlmWebrtcUrl";
import { rewriteSignalingUrlForBrowser } from "./zlmProxyUrl";

export interface UavPlatformPlayRequest {
  deviceSn: string;
  payloadIndex: string;
}
const CLIENT_TIMEOUT_MS = 9000;

function toSignalingUrl(rawUrl: string): string {
  const raw = rawUrl.trim();
  if (!raw) throw new Error("空流地址");
  if (raw.startsWith("webrtc://")) {
    // 复用已有逻辑
    const noProto = raw.slice("webrtc://".length);
    const [hostPort, ...segments] = noProto.split("/");
    const app = segments[0] ?? "live";
    const stream = segments.slice(1).join("/") || "livestream";
    return rewriteSignalingUrlForBrowser(`http://${hostPort}/index/api/webrtc?app=${encodeURIComponent(app)}&stream=${encodeURIComponent(stream)}&type=play`);
  }
  if (raw.includes("/index/api/webrtc")) {
    return rewriteSignalingUrlForBrowser(raw);
  }
  if (raw.startsWith("rtmp://") || raw.startsWith("rtsp://")) {
    const u = new URL(raw);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error(`不支持的流地址路径: ${raw}`);
    const app = parts[0];
    const stream = parts.slice(1).join("/");
    const webrtcPort = process.env.NEXT_PUBLIC_ZLM_WEBRTC_PORT?.trim() || "1985";
    const signaling = `${u.protocol === "https:" ? "https" : "http"}://${u.hostname}:${webrtcPort}/index/api/webrtc?app=${encodeURIComponent(app)}&stream=${encodeURIComponent(stream)}&type=play`;
    return rewriteSignalingUrlForBrowser(signaling);
  }
  throw new Error(`暂不支持的无人机流地址格式: ${raw.slice(0, 120)}`);
}

export async function fetchUavPlatformSignalingUrl(req: UavPlatformPlayRequest): Promise<{ rawUrl: string; signalingUrl: string }> {
  const deviceSn = req.deviceSn.trim();
  const payloadIndex = req.payloadIndex.trim();
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort("uav-live-start-timeout"), CLIENT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("/api/uav-live/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        deviceSn,
        payloadIndex,
        urlType: 1,
        videoQuality: 0,
      }),
      cache: "no-store",
      signal: ac.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`无人机平台取流请求超时或失败: ${msg}`);
  } finally {
    window.clearTimeout(timer);
  }
  const text = await res.text().catch(() => "");
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok || json.ok !== true) {
    throw new Error(`无人机平台取流 ${res.status}: ${text.slice(0, 300)}`);
  }
  const rawUrl = typeof json.rawUrl === "string" ? json.rawUrl.trim() : "";
  const hint = typeof json.hint === "string" ? json.hint.trim() : "";

  /** 平台已推流但不下发 url：与 direct ZLM `buildUavZlmSignalingUrl(SN,payload)` 一致 */
  if (!rawUrl && hint === "already_streaming_no_url") {
    const zlmDirect = rewriteSignalingUrlForBrowser(buildUavZlmSignalingUrl(deviceSn, payloadIndex));
    return { rawUrl: "", signalingUrl: zlmDirect };
  }

  if (!rawUrl) throw new Error("无人机平台返回空 rawUrl");
  return {
    rawUrl,
    signalingUrl: toSignalingUrl(rawUrl),
  };
}
