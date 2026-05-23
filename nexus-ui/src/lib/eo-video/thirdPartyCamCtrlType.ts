import type { EoVideoStreamEntry } from "./types";

/** 8090 列表 `ontology.specificType`：UDP 组播 + YUV 中继（原高速相机） */
export const ONTOLOGY_THIRD_PARTY_UDP_IMAGE = "ThirdPartyUdpCameraImage";
/** 8090 列表 `ontology.specificType`：WebRTC（`sensorParameters.url`） */
export const ONTOLOGY_THIRD_PARTY_VIDEO_WEBRTC = "ThirdPartyUdpCameraVideo";

/** 旧实体类型，兼容为 UDP 图传；若仍带 `camCtrlType=8` 则走 WebRTC */
export const ONTOLOGY_THIRD_PARTY_LEGACY = "ThirdPartyCamera";

export type ThirdPartyPlaybackFromOntology = "udp" | "webrtc";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 读取 `ontology.specificType`（大小写不敏感） */
export function readOntologySpecificType(raw: Record<string, unknown>): string {
  const o = raw.ontology;
  if (!isRecord(o)) return "";
  return String(o.specificType ?? "").trim();
}

function normOntologySt(st: string): string {
  return st.trim().toUpperCase();
}

export function isThirdPartyOntologySpecificType(st: string): boolean {
  const u = normOntologySt(st);
  return (
    u === normOntologySt(ONTOLOGY_THIRD_PARTY_UDP_IMAGE) ||
    u === normOntologySt(ONTOLOGY_THIRD_PARTY_VIDEO_WEBRTC) ||
    u === normOntologySt(ONTOLOGY_THIRD_PARTY_LEGACY)
  );
}

/** 是否第三方相机实体（仅看 ontology.specificType） */
export function isThirdPartyCameraOntologyRow(raw: Record<string, unknown>): boolean {
  return isThirdPartyOntologySpecificType(readOntologySpecificType(raw));
}

function pickCamCtrlTypeFromRecord(r: Record<string, unknown>): number | undefined {
  const keys = ["camCtrlType", "cam_ctrl_type", "ctrlType", "ctrltype"];
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number.parseInt(v.trim(), 10);
  }
  return undefined;
}

/** 旧列表若仍带 `camCtrlType`，仅在与 legacy `ThirdPartyCamera` 并存时作 WebRTC 回退 */
export function parseCamCtrlTypeLegacy(raw: Record<string, unknown>): number | undefined {
  const direct = pickCamCtrlTypeFromRecord(raw);
  if (direct !== undefined) return direct;
  for (const nest of [raw.properties, raw.sensorParameters, raw.ontology, raw.configuration]) {
    if (!isRecord(nest)) continue;
    const nested = pickCamCtrlTypeFromRecord(nest);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** 由 `ontology.specificType` 决定 UDP 图传 vs WebRTC（8090 列表主路径） */
export function classifyThirdPartyPlaybackFromOntology(raw: Record<string, unknown>): ThirdPartyPlaybackFromOntology | null {
  const st = readOntologySpecificType(raw);
  if (!isThirdPartyOntologySpecificType(st)) return null;
  const u = normOntologySt(st);
  if (u === normOntologySt(ONTOLOGY_THIRD_PARTY_VIDEO_WEBRTC)) return "webrtc";
  if (u === normOntologySt(ONTOLOGY_THIRD_PARTY_UDP_IMAGE)) return "udp";
  if (u === normOntologySt(ONTOLOGY_THIRD_PARTY_LEGACY)) {
    return parseCamCtrlTypeLegacy(raw) === 8 ? "webrtc" : "udp";
  }
  return null;
}

/** 右键菜单里走 UDP/YUV 栈的第三方相机 */
export function isThirdPartyUdpStreamEntry(entry: EoVideoStreamEntry | null | undefined): boolean {
  return entry?.registrySource === "thirdPartyCamera" && entry.playbackKind !== "webrtc";
}

/** 右键菜单里走 WebRTC 的第三方相机 */
export function isThirdPartyWebrtcStreamEntry(entry: EoVideoStreamEntry | null | undefined): boolean {
  return entry?.registrySource === "thirdPartyCamera" && entry.playbackKind === "webrtc";
}
