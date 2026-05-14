import { canonicalEntityId } from "@/lib/camera-entity-id";
import type { EoCameraRegistryRow } from "@/lib/eo-video/cameraRegistryTypes";
import type { MapGisDroneRow } from "@/lib/map-gis-drone-rows";
import {
  fetchCameraRegistryFromPublic,
  fetchDroneDevicesFromPublic,
  fetchThirdPartyCamerasFromApi,
} from "@/lib/eo-video/mergeEoVideoRegistry";

/**
 * 与 `EoVideoPanel` / `mergeRegistryStreams` 右键菜单展示一致：
 * - 相机：`camera-registry` / 第三方相机的 `label` **优先**，否则 `eo-video.streams.json` 对应 `id` 的静态 `label`
 * - 无人机：`name?.trim() || entityId`（与 `mergeRegistryStreams` 里 UAV 流 `label` 一致）
 */
export type MapGisEoMenuContext = {
  cameraLabelByEntityId: Map<string, string>;
  droneLabelByDeviceSn: Map<string, string>;
  registryDroneRows: MapGisDroneRow[];
  /** 与 eo-video 同源：`ontology.specificType === ThirdPartyCamera`（地图光电子菜单需单独合并，实体快照不含此类 id） */
  thirdPartyCameras: EoCameraRegistryRow[];
};

async function fetchStreamsStaticById(): Promise<Map<string, string>> {
  try {
    /** 优先走同源 API（读 `public/config`，避免生产环境未挂载 `/config` 导致 404） */
    const res = await fetch("/api/map-gis/eo-video-streams-labels", { cache: "no-store" });
    if (!res.ok) return new Map();
    const j = (await res.json()) as { streams?: Array<{ id?: unknown; label?: unknown }> };
    const m = new Map<string, string>();
    for (const s of j.streams ?? []) {
      const rawId = s.id;
      const id = typeof rawId === "string" ? canonicalEntityId(rawId.trim()) : "";
      const lb = typeof s.label === "string" ? s.label.trim() : "";
      if (id && lb) m.set(id, lb);
    }
    return m;
  } catch {
    return new Map();
  }
}

export async function fetchMapGisEoMenuContext(): Promise<MapGisEoMenuContext> {
  const [staticById, registryCams, devices, thirdParty] = await Promise.all([
    fetchStreamsStaticById(),
    fetchCameraRegistryFromPublic(),
    fetchDroneDevicesFromPublic(),
    fetchThirdPartyCamerasFromApi(),
  ]);

  const regByCanon = new Map<string, string>();
  const putCam = (entityId: string, label: string) => {
    const id = canonicalEntityId(entityId.trim());
    if (!id) return;
    regByCanon.set(id, String(label ?? "").trim());
  };
  for (const c of registryCams) putCam(c.entityId, c.label);
  for (const c of thirdParty) putCam(c.entityId, c.label);

  const ids = new Set<string>([...regByCanon.keys(), ...staticById.keys()]);
  const cameraLabelByEntityId = new Map<string, string>();
  for (const id of ids) {
    const r = regByCanon.get(id)?.trim() ?? "";
    const st = staticById.get(id)?.trim() ?? "";
    cameraLabelByEntityId.set(id, r || st || id);
  }

  const droneLabelByDeviceSn = new Map<string, string>();
  const registryDroneRows: MapGisDroneRow[] = [];
  for (const d of devices) {
    const sn = String(d.deviceSN ?? "").trim();
    const ap = String(d.airportSN ?? "").trim();
    if (!sn || !ap) continue;
    const lb = (d.name ?? "").trim() || String(d.entityId ?? "").trim() || sn;
    droneLabelByDeviceSn.set(sn, lb);
    registryDroneRows.push({ sn, airportSN: ap, label: lb });
  }
  registryDroneRows.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));

  return { cameraLabelByEntityId, droneLabelByDeviceSn, registryDroneRows, thirdPartyCameras: thirdParty };
}
