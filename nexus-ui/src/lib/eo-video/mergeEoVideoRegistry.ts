import type { EoCameraRegistryRow } from "./cameraRegistryTypes";
import type { EoDroneDeviceRow } from "./droneRegistryTypes";
import { isCameraEntityId } from "./mapEntitiesToCameraDevices";
import { getThirdPartyCameraMulticastUdp } from "./thirdPartyCameraMulticast";
import { normThirdPartyEntityId } from "./thirdPartyEntityId";
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
  /**
   * 只按 registrySource 剥离；不要用 `uav:` 前缀清掉无 source 的占位流。
   * 刷新后记忆流常是 `uav:…`，注册表未到前需占位；若按前缀 strip，会落到 dock 默认
   * camera_004 并写回 localStorage，冲掉无人机记忆（相机 id 不受此影响故能记住）。
   */
  const streams = c.streams.filter(
    (s) =>
      s.registrySource !== "camera" &&
      s.registrySource !== "uav" &&
      s.registrySource !== "thirdPartyCamera",
  );
  return { ...c, streams };
}

async function fetchCameraRegistryFromStaticFile(): Promise<EoCameraRegistryRow[]> {
  try {
    const r = await fetch("/config/eo-video.camera-registry.json", { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { cameras?: EoCameraRegistryRow[] };
    return Array.isArray(j.cameras) ? j.cameras : [];
  } catch {
    return [];
  }
}

type LiveCameraRegistryResult =
  | { ok: true; cameras: EoCameraRegistryRow[] }
  | { ok: false; cameras: [] };

/** 8090 实时光电相机列表（`NEXUS_ENTITIES_LIST_URL`） */
export async function fetchCameraRegistryFromApi(): Promise<LiveCameraRegistryResult> {
  try {
    const r = await fetch("/api/nexus-entities/opto-cameras", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { ok: false, cameras: [] };
    const j = (await r.json()) as { ok?: boolean; cameras?: EoCameraRegistryRow[] };
    if (j.ok !== true || !Array.isArray(j.cameras)) return { ok: false, cameras: [] };
    return { ok: true, cameras: j.cameras };
  } catch {
    return { ok: false, cameras: [] };
  }
}

/**
 * 光电右键菜单相机列表：
 * - 8090 **成功**：只用实时列表（含空列表）；静态 JSON 仅补全同 id 的 label
 * - 8090 **失败**：才回退 `eo-video.camera-registry.json`
 * 避免 18.36 等现场只有少量实体时仍被 141 同步的静态 registry 灌满菜单。
 */
export async function fetchCameraRegistryFromPublic(): Promise<EoCameraRegistryRow[]> {
  const [live, staticRows] = await Promise.all([
    fetchCameraRegistryFromApi(),
    fetchCameraRegistryFromStaticFile(),
  ]);
  if (!live.ok) return staticRows;

  const labelById = new Map(
    staticRows.map((c) => [c.entityId, (c.label ?? "").trim()] as const),
  );
  return live.cameras
    .map((c) => ({
      ...c,
      label: c.label?.trim() || labelById.get(c.entityId) || c.entityId,
    }))
    .sort((a, b) => a.entityId.localeCompare(b.entityId, undefined, { numeric: true }));
}

async function fetchDroneDevicesFromStaticFile(): Promise<EoDroneDeviceRow[]> {
  try {
    const r = await fetch("/config/eo-video.drone-devices.json", { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { devices?: EoDroneDeviceRow[] };
    return Array.isArray(j.devices) ? j.devices : [];
  } catch {
    return [];
  }
}

type LiveDroneDevicesResult =
  | { ok: true; devices: EoDroneDeviceRow[] }
  | { ok: false; devices: [] };

/** 8090 实时无人机列表（`NEXUS_ENTITIES_LIST_URL`，`indicators.simulated === false`） */
export async function fetchDroneDevicesFromApi(): Promise<LiveDroneDevicesResult> {
  try {
    const r = await fetch("/api/nexus-entities/drones", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { ok: false, devices: [] };
    const j = (await r.json()) as { ok?: boolean; devices?: EoDroneDeviceRow[] };
    if (j.ok !== true || !Array.isArray(j.devices)) return { ok: false, devices: [] };
    return { ok: true, devices: j.devices };
  } catch {
    return { ok: false, devices: [] };
  }
}

/** 资产列表侧边栏：含 `indicators.simulated === true` 的虚兵无人机 */
export async function fetchDroneDevicesForAssetPanel(): Promise<EoDroneDeviceRow[]> {
  try {
    const r = await fetch("/api/nexus-entities/drones?includeSimulated=1", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { ok?: boolean; devices?: EoDroneDeviceRow[] };
    if (j.ok !== true || !Array.isArray(j.devices)) return [];
    return j.devices;
  } catch {
    return [];
  }
}

/**
 * 光电右键「无人机」：
 * - 8090 **成功**：只用实时列表（可为空）；静态 JSON 仅补全同 id 名称
 * - 8090 **失败**：才回退 `eo-video.drone-devices.json`
 */
export async function fetchDroneDevicesFromPublic(): Promise<EoDroneDeviceRow[]> {
  const [live, staticRows] = await Promise.all([
    fetchDroneDevicesFromApi(),
    fetchDroneDevicesFromStaticFile(),
  ]);
  if (!live.ok) return staticRows;

  const nameById = new Map(
    staticRows.map((d) => [d.entityId, (d.name ?? "").trim()] as const),
  );
  return live.devices
    .map((d) => ({
      ...d,
      name: d.name?.trim() || nameById.get(d.entityId) || d.entityId,
    }))
    .sort((a, b) => a.entityId.localeCompare(b.entityId, undefined, { numeric: true }));
}

/** 服务端走 `NEXUS_ENTITIES_LIST_URL`（见 `/api/nexus-entities/third-party-cameras`） */
export async function fetchThirdPartyCamerasFromApi(): Promise<Required<ThirdPartyCamerasRegistryInput>> {
  try {
    const r = await fetch("/api/nexus-entities/third-party-cameras", {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
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

  const thirdPartyMulticast = getThirdPartyCameraMulticastUdp();
  const apiThirdPartyUdpStreams: EoVideoStreamEntry[] = thirdParty.udp.map((c) => ({
    id: c.entityId,
    label: c.label,
    signalingUrl: "",
    registrySource: "thirdPartyCamera",
    ontologySpecificType: c.ontologySpecificType,
    ...(thirdPartyMulticast ? { multicastUdp: thirdPartyMulticast } : {}),
  }));
  const apiThirdPartyWebrtcStreams: EoVideoStreamEntry[] = thirdParty.webrtc.map((c) => ({
    id: c.entityId,
    label: c.label,
    signalingUrl: c.signalingUrl?.trim() || "about:blank",
    registrySource: "thirdPartyCamera",
    ontologySpecificType: c.ontologySpecificType,
    playbackKind: "webrtc" as const,
  }));
  const apiThirdPartyStreams = [...apiThirdPartyUdpStreams, ...apiThirdPartyWebrtcStreams];
  const thirdPartyIdSet = new Set(apiThirdPartyStreams.map((s) => s.id));
  const thirdPartyNormSet = new Set(
    apiThirdPartyStreams.map((s) => normThirdPartyEntityId(s.id)).filter(Boolean),
  );

  const stripped = stripRegistryStreams(base);
  /**
   * 丢弃静态/记忆占位里的 camera_*：光电菜单以 8090/`apiCameras` 为准，
   * 避免 141 同步的 streams/registry 残留把 18.36 菜单灌满。
   * 第三方/无人机记忆占位仍按下方规则剔除以免抢流黑屏。
   */
  const staticStreams = stripped.streams.filter((s) => {
    if (isCameraEntityId(s.id)) return false;
    if (thirdPartyIdSet.has(s.id)) return false;
    const norm = normThirdPartyEntityId(s.id);
    if (norm && thirdPartyNormSet.has(norm)) return false;
    if (s.id.startsWith("uav:") && apiDrones.length > 0) return false;
    return true;
  });

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
      s.registrySource !== "thirdPartyCamera",
  );
  const groups = c.contextMenu.groups.filter(
    (g) => g.label !== "无人机" && g.label !== "光电" && g.label !== "第三方相机",
  );
  return { ...c, streams, contextMenu: { ...c.contextMenu, groups } };
}
