import type { EoCameraRegistryFile, EoCameraRegistryRow } from "./cameraRegistryTypes";
import { extractEntityRecords } from "./mapEntitiesToDroneDevices";
import {
  classifyThirdPartyPlaybackFromOntology,
  isThirdPartyCameraOntologyRow,
  isThirdPartyOntologySpecificType,
  readOntologySpecificType,
} from "./thirdPartyCamCtrlType";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickStr(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** 与 EoVideoPanel 一致：camera_000 … camera_999 */
export function isCameraEntityId(id: string): boolean {
  return /^camera_[0-9]{3}$/i.test(id.trim());
}

function cameraLabel(raw: Record<string, unknown>, entityId: string): string {
  const aliases = raw.aliases;
  if (isRecord(aliases) && typeof aliases.name === "string" && aliases.name.trim()) {
    return aliases.name.trim();
  }
  return entityId;
}

function isCameraOntology(raw: Record<string, unknown>): boolean {
  const st = readOntologySpecificType(raw);
  if (isThirdPartyOntologySpecificType(st)) return false;
  const o = raw.ontology;
  if (!isRecord(o)) return false;
  const stu = st.toUpperCase();
  const tpl = String(o.template ?? "").toUpperCase();
  if (stu.includes("CAMERA") || stu === "EO" || stu === "IR") return true;
  if (tpl.includes("CAMERA") || tpl.includes("SENSOR")) return true;
  return false;
}

function mapThirdPartyCameraOne(raw: unknown): EoCameraRegistryRow | null {
  if (!isRecord(raw)) return null;
  if (!isThirdPartyCameraOntologyRow(raw)) return null;
  const entityId = pickStr(raw, ["entityId", "entity_id", "id"]);
  if (!entityId) return null;
  const playback = classifyThirdPartyPlaybackFromOntology(raw);
  if (!playback) return null;
  const ontologySpecificType = readOntologySpecificType(raw);
  return {
    entityId,
    label: cameraLabel(raw, entityId),
    ontologySpecificType,
    thirdPartyPlayback: playback,
  };
}

export type ThirdPartyCamerasByCtrlType = {
  /** `ThirdPartyUdpCameraImage`（及旧 `ThirdPartyCamera`）→ UDP/YUV */
  udp: EoCameraRegistryRow[];
  /** `ThirdPartyUdpCameraVideo` → WebRTC */
  webrtc: EoCameraRegistryRow[];
};

/**
 * 8090 列表（`NEXUS_ENTITIES_LIST_URL`）：
 * - `ontology.specificType === ThirdPartyUdpCameraImage` → UDP
 * - `ontology.specificType === ThirdPartyUdpCameraVideo` → WebRTC
 * - 旧 `ThirdPartyCamera` 仍支持（默认 UDP，`camCtrlType=8` 时 WebRTC）
 */
export function mapEntitiesPayloadToThirdPartyCamerasSplit(payload: unknown): ThirdPartyCamerasByCtrlType {
  const rows = extractEntityRecords(payload);
  const udp: EoCameraRegistryRow[] = [];
  const webrtc: EoCameraRegistryRow[] = [];
  const seenUdp = new Set<string>();
  const seenWeb = new Set<string>();
  for (const r of rows) {
    const c = mapThirdPartyCameraOne(r);
    if (!c) continue;
    if (c.thirdPartyPlayback === "webrtc") {
      if (seenWeb.has(c.entityId)) continue;
      seenWeb.add(c.entityId);
      webrtc.push(c);
    } else {
      if (seenUdp.has(c.entityId)) continue;
      seenUdp.add(c.entityId);
      udp.push(c);
    }
  }
  const sort = (a: EoCameraRegistryRow, b: EoCameraRegistryRow) =>
    a.entityId.localeCompare(b.entityId, undefined, { numeric: true });
  return { udp: udp.sort(sort), webrtc: webrtc.sort(sort) };
}

/** 右键「第三方相机」菜单展示用：UDP + WebRTC 合并列表 */
export function mapEntitiesPayloadToThirdPartyCameras(payload: unknown): EoCameraRegistryRow[] {
  const { udp, webrtc } = mapEntitiesPayloadToThirdPartyCamerasSplit(payload);
  return [...udp, ...webrtc];
}

function mapCameraOne(raw: unknown): EoCameraRegistryRow | null {
  if (!isRecord(raw)) return null;
  const entityId = pickStr(raw, ["entityId", "entity_id", "id"]);
  if (!entityId) return null;
  /** 第三方 ontology 归「第三方相机」菜单，不进光电 */
  if (isThirdPartyCameraOntologyRow(raw)) return null;
  if (!isCameraEntityId(entityId) && !isCameraOntology(raw)) return null;
  return {
    entityId,
    label: cameraLabel(raw, entityId),
  };
}

export function mapEntitiesPayloadToCameras(payload: unknown): EoCameraRegistryRow[] {
  const rows = extractEntityRecords(payload);
  const out: EoCameraRegistryRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = mapCameraOne(r);
    if (!c) continue;
    if (seen.has(c.entityId)) continue;
    seen.add(c.entityId);
    out.push(c);
  }
  return out.sort((a, b) => a.entityId.localeCompare(b.entityId, undefined, { numeric: true }));
}

export function buildCameraRegistryFile(sourceUrl: string, payload: unknown): EoCameraRegistryFile {
  return {
    syncedAt: new Date().toISOString(),
    sourceUrl,
    cameras: mapEntitiesPayloadToCameras(payload),
  };
}

export { isThirdPartyCameraOntologyRow } from "./thirdPartyCamCtrlType";
