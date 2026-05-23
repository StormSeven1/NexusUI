import type { EoCameraRegistryRow } from "./cameraRegistryTypes";
import type { EoDroneDeviceRow } from "./droneRegistryTypes";
import { isCameraEntityId } from "./mapEntitiesToCameraDevices";
import { getThirdPartyCameraMulticastUdp } from "./thirdPartyCameraMulticast";
import type { EoVideoStreamEntry, EoVideoStreamsConfig } from "./types";

export type ThirdPartyCamerasRegistryInput = {
  udp: EoCameraRegistryRow[];
  webrtc: Array<EoCameraRegistryRow & { signalingUrl?: string }>;
};

function normalizeThirdPartyRegistryInput(
  thirdPartyCameras: EoCameraRegistryRow[] | ThirdPartyCamerasRegistryInput = [],
): Required<ThirdPartyCamerasRegistryInput> {
  if (Array.isArray(thirdPartyCameras)) {
    return { udp: thirdPartyCameras, webrtc: [] };
  }
  return {
    udp: thirdPartyCameras.udp ?? [],
    webrtc: thirdPartyCameras.webrtc ?? [],
  };
}

/** 去掉从注册表合并的相机/无人机流（保留 JSON 静态流） */
export function stripRegistryStreams(c: EoVideoStreamsConfig): EoVideoStreamsConfig {
  const streams = c.streams.filter(
    (s) =>
      s.registrySource !== "camera" &&
      s.registrySource !== "uav" &&
      s.registrySource !== "thirdPartyCamera" &&
      !s.id.startsWith("uav:"),
  );
  return { ...c, streams };
}

export async function fetchCameraRegistryFromPublic(): Promise<EoCameraRegistryRow[]> {
  try {
    const r = await fetch("/config/eo-video.camera-registry.json", { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { cameras?: EoCameraRegistryRow[] };
    return Array.isArray(j.cameras) ? j.cameras : [];
  } catch {
    return [];
  }
}

export async function fetchDroneDevicesFromPublic(): Promise<EoDroneDeviceRow[]> {
  try {
    const r = await fetch("/config/eo-video.drone-devices.json", { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { devices?: EoDroneDeviceRow[] };
    return Array.isArray(j.devices) ? j.devices : [];
  } catch {
    return [];
  }
}

/** 服务端走 `NEXUS_ENTITIES_LIST_URL`（见 `/api/nexus-entities/third-party-cameras`） */
export async function fetchThirdPartyCamerasFromApi(): Promise<Required<ThirdPartyCamerasRegistryInput>> {
  try {
    const r = await fetch("/api/nexus-entities/third-party-cameras", { cache: "no-store" });
    if (!r.ok) return { udp: [], webrtc: [] };
    const j = (await r.json()) as {
      ok?: boolean;
      cameras?: EoCameraRegistryRow[];
      udpCameras?: EoCameraRegistryRow[];
      webrtcCameras?: Array<EoCameraRegistryRow & { signalingUrl?: string }>;
    };
    if (j.ok !== true) return { udp: [], webrtc: [] };
    if (Array.isArray(j.udpCameras) || Array.isArray(j.webrtcCameras)) {
      return {
        udp: Array.isArray(j.udpCameras) ? j.udpCameras : [],
        webrtc: Array.isArray(j.webrtcCameras) ? j.webrtcCameras : [],
      };
    }
    if (Array.isArray(j.cameras)) {
      return { udp: j.cameras, webrtc: [] };
    }
    return { udp: [], webrtc: [] };
  } catch {
    return { udp: [], webrtc: [] };
  }
}

/** 地图光电子菜单 / 标签合并：UDP + WebRTC 第三方相机 */
export async function fetchThirdPartyCameraMenuRowsFromApi(): Promise<EoCameraRegistryRow[]> {
  const split = await fetchThirdPartyCamerasFromApi();
  return [...split.udp, ...split.webrtc];
}

/**
 * 光电：API 相机 + 静态配置里非注册表流（如 eo-main）；
 * 无人机：API 无人机；
 * 第三方相机（8090 `ontology.specificType`）：
 * - `ThirdPartyUdpCameraImage`：YUV 栈 + 组播中继；
 * - `ThirdPartyUdpCameraVideo`：`sensorParameters.url` WebRTC。
 * 右键菜单为两级：hover 展开子项（见 contextMenu.menuLayout）。
 */
export function mergeRegistryStreams(
  base: EoVideoStreamsConfig,
  apiCameras: EoCameraRegistryRow[],
  apiDrones: EoDroneDeviceRow[],
  thirdPartyCameras: EoCameraRegistryRow[] | ThirdPartyCamerasRegistryInput = [],
): EoVideoStreamsConfig {
  const thirdParty = normalizeThirdPartyRegistryInput(thirdPartyCameras);
  const apiCameraIdSet = new Set(apiCameras.map((c) => c.entityId));

  const stripped = stripRegistryStreams(base);
  const staticStreams = stripped.streams.filter(
    (s) => !(isCameraEntityId(s.id) && apiCameraIdSet.has(s.id)),
  );

  const baseById = new Map(base.streams.map((s) => [s.id, s]));

  const apiCameraStreams: EoVideoStreamEntry[] = apiCameras.map((c) => {
    const existing = baseById.get(c.entityId);
    if (existing?.signalingUrl && existing.signalingUrl !== "about:blank") {
      return {
        ...existing,
        label: c.label || existing.label,
      };
    }
    return {
      id: c.entityId,
      label: c.label,
      signalingUrl: "about:blank",
      registrySource: "camera",
    };
  });

  const thirdPartyMulticast = getThirdPartyCameraMulticastUdp();
  const apiThirdPartyUdpStreams: EoVideoStreamEntry[] = thirdParty.udp.map((c) => ({
    id: c.entityId,
    label: c.label,
    signalingUrl: "",
    registrySource: "thirdPartyCamera",
    ...(thirdPartyMulticast ? { multicastUdp: thirdPartyMulticast } : {}),
  }));
  const apiThirdPartyWebrtcStreams: EoVideoStreamEntry[] = thirdParty.webrtc.map((c) => ({
    id: c.entityId,
    label: c.label,
    signalingUrl: c.signalingUrl?.trim() || "about:blank",
    registrySource: "thirdPartyCamera",
    playbackKind: "webrtc" as const,
  }));
  const apiThirdPartyStreams = [...apiThirdPartyUdpStreams, ...apiThirdPartyWebrtcStreams];

  const apiUavStreams: EoVideoStreamEntry[] = apiDrones.map((d) => ({
    id: `uav:${d.entityId}`,
    label: d.name?.trim() || d.entityId,
    signalingUrl: "about:blank",
    registrySource: "uav",
    uav: {
      entityId: d.entityId,
      deviceSN: d.deviceSN,
      airportSN: d.airportSN,
      vendor: d.vendor,
      dockPlaybackEntityId: d.dockPlaybackEntityId ?? d.airportSN ?? d.entityId,
      airPlaybackEntityId: d.airPlaybackEntityId ?? d.deviceSN ?? d.entityId,
    },
  }));

  const thirdPartyIdSet = new Set(apiThirdPartyStreams.map((s) => s.id));
  const streams = [...staticStreams, ...apiCameraStreams, ...apiThirdPartyStreams, ...apiUavStreams];
  const ids = new Set(streams.map((s) => s.id));

  const photoIds = [...apiCameraStreams.map((s) => s.id), ...staticStreams.map((s) => s.id)].filter(
    (id) => ids.has(id) && !thirdPartyIdSet.has(id),
  );
  const droneIds = apiUavStreams.map((s) => s.id).filter((id) => ids.has(id));
  const thirdPartyIds = apiThirdPartyStreams.map((s) => s.id).filter((id) => ids.has(id));

  const groups: EoVideoStreamsConfig["contextMenu"]["groups"] = [];
  if (photoIds.length) groups.push({ label: "光电", streamIds: photoIds });
  if (droneIds.length) groups.push({ label: "无人机", streamIds: droneIds });
  if (thirdPartyIds.length) groups.push({ label: "第三方相机", streamIds: thirdPartyIds });
  if (!groups.length) {
    groups.push({
      label: "视频源",
      streamIds: streams.map((s) => s.id),
    });
  }

  for (const g of groups) {
    for (const sid of g.streamIds) {
      if (!ids.has(sid)) throw new Error(`mergeRegistryStreams: unknown streamId ${sid}`);
    }
  }

  let defaultStreamId = base.defaultStreamId;
  if (!ids.has(defaultStreamId)) {
    defaultStreamId = streams[0]?.id ?? "eo-main";
  }

  return {
    ...base,
    defaultStreamId,
    streams,
    contextMenu: {
      ...base.contextMenu,
      menuLayout: "nested",
      groups,
    },
  };
}

/** @deprecated 使用 mergeRegistryStreams；仅无人机时传 cameras=[] */
export function mergeEoVideoDroneMenu(base: EoVideoStreamsConfig, devices: EoDroneDeviceRow[]): EoVideoStreamsConfig {
  return mergeRegistryStreams(base, [], devices);
}

/** @deprecated 使用 stripRegistryStreams */
export function stripDroneStreamsFromConfig(c: EoVideoStreamsConfig): EoVideoStreamsConfig {
  const streams = c.streams.filter(
    (s) =>
      s.registrySource !== "camera" &&
      s.registrySource !== "uav" &&
      s.registrySource !== "thirdPartyCamera" &&
      !s.id.startsWith("uav:"),
  );
  const groups = c.contextMenu.groups.filter(
    (g) => g.label !== "无人机" && g.label !== "光电" && g.label !== "第三方相机",
  );
  return { ...c, streams, contextMenu: { ...c.contextMenu, groups } };
}
