import type { EoVideoStreamEntry } from "./types";
import { rewriteSignalingUrlForBrowser } from "./zlmProxyUrl";

interface EoWebrtcSourcesResponse {
  streams?: Array<{
    id: string;
    label: string;
    webrtcUrl: string;
    signalingUrl: string;
  }>;
}

export async function loadZOthersWebRtcSources(): Promise<EoVideoStreamEntry[]> {
  const res = await fetch("/api/eo-webrtc-sources", { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as EoWebrtcSourcesResponse;
  if (!Array.isArray(data.streams)) return [];
  return data.streams
    .filter((s) => s && typeof s.id === "string" && typeof s.label === "string" && typeof s.signalingUrl === "string")
    .map((s) => ({
      id: s.id,
      label: s.label,
      webrtcUrl: s.webrtcUrl,
      signalingUrl: rewriteSignalingUrlForBrowser(s.signalingUrl),
    }));
}
