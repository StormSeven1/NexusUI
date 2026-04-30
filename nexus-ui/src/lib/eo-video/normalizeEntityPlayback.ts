import { signalingUrlFromWebrtcUrl } from "./buildSignalingUrl";
import type { EoVideoIceServer } from "./types";
import { rewriteSignalingUrlForBrowser } from "./zlmProxyUrl";

const DEFAULT_ICE: EoVideoIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export interface EntityPlaybackNormalized {
  signalingUrl: string;
  label: string;
  iceServers: EoVideoIceServer[];
  rawVideoUrl: string;
}

export function normalizeEntityPlaybackJson(data: unknown, fallbackId: string): EntityPlaybackNormalized {
  if (!data || typeof data !== "object") {
    throw new Error("实体 JSON 无效");
  }
  const o = data as Record<string, unknown>;

  const sp = o.sensorParameters;
  const urlFromSp =
    sp && typeof sp === "object" && typeof (sp as Record<string, unknown>).url === "string"
      ? ((sp as Record<string, unknown>).url as string).trim()
      : "";
  const rawUrl = urlFromSp;
  if (!rawUrl) {
    throw new Error("实体未返回 sensorParameters.url（可能离线或无流地址）");
  }

  let signalingUrl: string;
  if (rawUrl.startsWith("webrtc://")) {
    signalingUrl = signalingUrlFromWebrtcUrl(rawUrl);
  } else if (rawUrl.includes("/index/api/webrtc")) {
    signalingUrl = rawUrl;
  } else {
    throw new Error(`暂不支持的流地址格式: ${rawUrl.slice(0, 120)}`);
  }

  signalingUrl = rewriteSignalingUrlForBrowser(signalingUrl);

  const aliases = o.aliases;
  const name =
    aliases && typeof aliases === "object" && typeof (aliases as Record<string, unknown>).name === "string"
      ? ((aliases as Record<string, unknown>).name as string).trim()
      : "";

  const label =
    name ||
    (typeof o.entityId === "string" && o.entityId.trim()) ||
    (typeof o.id === "string" && o.id.trim()) ||
    fallbackId;

  return {
    signalingUrl,
    label,
    iceServers: DEFAULT_ICE,
    rawVideoUrl: rawUrl,
  };
}
