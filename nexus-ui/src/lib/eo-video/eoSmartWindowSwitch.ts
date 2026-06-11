import { canonicalEntityId, parseCameraEntityIdFromStreamId } from "@/lib/camera-entity-id";
import { EO_ELECTRO_OPTICAL_PANEL_IDS } from "@/lib/eo-video/eoElectroOpticalDockPool";
import { isCameraEntityId } from "@/lib/eo-video/mapEntitiesToCameraDevices";
import { isThirdPartyUdpStreamEntry } from "@/lib/eo-video/thirdPartyCamCtrlType";
import {
  formatEoDdsCameraLine,
  formatEoDdsDroneTaskLine,
} from "@/lib/eo-video/formatEoDdsTaskOverlay";
import type { EoVideoStreamEntry } from "@/lib/eo-video/types";
import type { EoCameraDdsStatusRow } from "@/stores/eo-camera-dds-status-store";
import type { EoDroneDdsStatusRow } from "@/stores/eo-drone-dds-status-store";

/** 与 dock 注册表一致，用于跨窗占用检测 */
export const EO_VIDEO_DOCK_PANEL_IDS = ["electro-optical", ...EO_ELECTRO_OPTICAL_PANEL_IDS];

export interface SmartWindowPanelState {
  panelId: string;
  activeStreamId: string;
  lockedUavStreamId: string | null;
}

export interface SmartWindowSwitchInput {
  streams: EoVideoStreamEntry[];
  cameraByEntityId: Record<string, EoCameraDdsStatusRow>;
  droneByEntityId: Record<string, EoDroneDdsStatusRow>;
  lockedUavStreamId: string | null;
  pageEntity?: string;
  /** 其它光电窗已在显示的设备键（uav: / cam:） */
  occupiedDeviceKeys?: ReadonlySet<string>;
  /** 本轮已分配给其它智能窗的设备键 */
  reservedDeviceKeys?: ReadonlySet<string>;
}

export interface SmartWindowSwitchResult {
  targetStreamId: string | null;
  nextLockedUavStreamId: string | null;
}

function resolveStreamCameraEntityId(
  stream: EoVideoStreamEntry,
  pageEntity?: string,
): string | undefined {
  if (isThirdPartyUdpStreamEntry(stream)) return undefined;
  if (stream.registrySource === "thirdPartyCamera") return undefined;
  if (stream.uav) return undefined;
  if (stream.registrySource === "camera" && stream.id && isCameraEntityId(stream.id)) {
    return canonicalEntityId(stream.id);
  }
  const sid = stream.id.trim();
  if (isCameraEntityId(sid)) return canonicalEntityId(sid);
  const fromStream = parseCameraEntityIdFromStreamId(sid);
  if (fromStream) return fromStream;
  const ent = pageEntity?.trim() ?? "";
  if (ent) {
    if (isCameraEntityId(ent)) return canonicalEntityId(ent);
    const fromEnt = parseCameraEntityIdFromStreamId(ent);
    if (fromEnt) return fromEnt;
  }
  return undefined;
}

function resolveStreamDroneEntityId(stream: EoVideoStreamEntry): string | undefined {
  const raw = stream.uav?.entityId?.trim();
  return raw ? canonicalEntityId(raw) : undefined;
}

/** 设备唯一键：用于跨窗去重与多智能窗分配 */
export function streamDeviceKey(
  stream: EoVideoStreamEntry | undefined,
  pageEntity?: string,
): string | null {
  if (!stream) return null;
  if (stream.uav) {
    const id = resolveStreamDroneEntityId(stream);
    return id ? `uav:${id}` : null;
  }
  const camId = resolveStreamCameraEntityId(stream, pageEntity);
  return camId ? `cam:${camId}` : null;
}

export function buildOccupiedDeviceKeys(
  allPanelMainStreams: Record<string, string>,
  streams: EoVideoStreamEntry[],
  excludePanelId: string,
  pageEntity?: string,
): Set<string> {
  const occupied = new Set<string>();
  for (const panelId of EO_VIDEO_DOCK_PANEL_IDS) {
    if (panelId === excludePanelId) continue;
    const streamId = allPanelMainStreams[panelId]?.trim();
    if (!streamId) continue;
    const stream = streams.find((s) => s.id === streamId);
    const key = streamDeviceKey(stream, pageEntity);
    if (key) occupied.add(key);
  }
  return occupied;
}

function isDroneExecuting(row: EoDroneDdsStatusRow | undefined): boolean {
  return formatEoDdsDroneTaskLine(row) !== "空闲中";
}

function isCameraExecuting(row: EoCameraDdsStatusRow | undefined): boolean {
  return formatEoDdsCameraLine(row) !== "空闲中";
}

function findStreamById(streams: EoVideoStreamEntry[], streamId: string): EoVideoStreamEntry | undefined {
  return streams.find((s) => s.id === streamId);
}

function isDeviceExcluded(
  deviceKey: string | null,
  occupied: ReadonlySet<string> | undefined,
  reserved: ReadonlySet<string> | undefined,
): boolean {
  if (!deviceKey) return true;
  if (occupied?.has(deviceKey)) return true;
  if (reserved?.has(deviceKey)) return true;
  return false;
}

/**
 * 单窗切流：无人机优先且锁定不可抢占；相机次之。
 * 跳过已被其它窗占用或已分配给其它智能窗的设备。
 */
export function pickSmartWindowTarget(input: SmartWindowSwitchInput): SmartWindowSwitchResult {
  const {
    streams,
    cameraByEntityId,
    droneByEntityId,
    lockedUavStreamId,
    pageEntity,
    occupiedDeviceKeys,
    reservedDeviceKeys,
  } = input;

  if (lockedUavStreamId) {
    const lockedStream = findStreamById(streams, lockedUavStreamId);
    const lockedKey = streamDeviceKey(lockedStream, pageEntity);
    const lockedDroneId = lockedStream ? resolveStreamDroneEntityId(lockedStream) : undefined;
    const lockedRow = lockedDroneId ? droneByEntityId[lockedDroneId] : undefined;
    if (
      lockedStream &&
      lockedKey &&
      isDroneExecuting(lockedRow) &&
      !isDeviceExcluded(lockedKey, occupiedDeviceKeys, reservedDeviceKeys)
    ) {
      return { targetStreamId: lockedUavStreamId, nextLockedUavStreamId: lockedUavStreamId };
    }
  }

  let bestUav: { streamId: string; deviceKey: string; updatedAt: number } | null = null;
  for (const stream of streams) {
    if (!stream.uav) continue;
    const droneId = resolveStreamDroneEntityId(stream);
    if (!droneId) continue;
    const deviceKey = `uav:${droneId}`;
    if (isDeviceExcluded(deviceKey, occupiedDeviceKeys, reservedDeviceKeys)) continue;
    const row = droneByEntityId[droneId];
    if (!isDroneExecuting(row)) continue;
    const updatedAt = row?.updatedAt ?? 0;
    if (!bestUav || updatedAt > bestUav.updatedAt) {
      bestUav = { streamId: stream.id, deviceKey, updatedAt };
    }
  }
  if (bestUav) {
    return { targetStreamId: bestUav.streamId, nextLockedUavStreamId: bestUav.streamId };
  }

  let bestCam: { streamId: string; deviceKey: string; updatedAt: number } | null = null;
  for (const stream of streams) {
    if (stream.uav) continue;
    const camId = resolveStreamCameraEntityId(stream, pageEntity);
    if (!camId) continue;
    const deviceKey = `cam:${camId}`;
    if (isDeviceExcluded(deviceKey, occupiedDeviceKeys, reservedDeviceKeys)) continue;
    const row = cameraByEntityId[camId];
    if (!isCameraExecuting(row)) continue;
    const updatedAt = row?.updatedAt ?? 0;
    if (!bestCam || updatedAt > bestCam.updatedAt) {
      bestCam = { streamId: stream.id, deviceKey, updatedAt };
    }
  }
  if (bestCam) {
    return { targetStreamId: bestCam.streamId, nextLockedUavStreamId: null };
  }

  return { targetStreamId: null, nextLockedUavStreamId: null };
}

export interface AllocateSmartWindowTargetsInput {
  streams: EoVideoStreamEntry[];
  cameraByEntityId: Record<string, EoCameraDdsStatusRow>;
  droneByEntityId: Record<string, EoDroneDdsStatusRow>;
  allPanelMainStreams: Record<string, string>;
  smartPanels: SmartWindowPanelState[];
  pageEntity?: string;
}

/**
 * 多智能窗协同分配：按 panelId 排序，依次为每个智能窗分配不同执行中设备；
 * 已被任意其它光电窗占用的设备不再分配。
 */
export function allocateSmartWindowTargets(
  input: AllocateSmartWindowTargetsInput,
): Record<string, SmartWindowSwitchResult> {
  const { streams, cameraByEntityId, droneByEntityId, allPanelMainStreams, smartPanels, pageEntity } =
    input;
  const results: Record<string, SmartWindowSwitchResult> = {};
  const reservedDevices = new Set<string>();
  const sorted = [...smartPanels].sort((a, b) => a.panelId.localeCompare(b.panelId));

  for (const panel of sorted) {
    const occupiedElsewhere = buildOccupiedDeviceKeys(
      allPanelMainStreams,
      streams,
      panel.panelId,
      pageEntity,
    );
    const result = pickSmartWindowTarget({
      streams,
      cameraByEntityId,
      droneByEntityId,
      lockedUavStreamId: panel.lockedUavStreamId,
      pageEntity,
      occupiedDeviceKeys: occupiedElsewhere,
      reservedDeviceKeys: reservedDevices,
    });
    results[panel.panelId] = result;
    if (result.targetStreamId) {
      const stream = findStreamById(streams, result.targetStreamId);
      const key = streamDeviceKey(stream, pageEntity);
      if (key) reservedDevices.add(key);
    }
  }

  return results;
}
