import { canonicalEntityId } from "@/lib/camera-entity-id";
import {
  ensureEntitiesTrackTaskCache,
  listTrackTaskOwnerRows,
  type EntityTaskRow,
} from "@/lib/entities-track-task-cache";
import type { EoCameraRegistryRow } from "@/lib/eo-video/cameraRegistryTypes";
import { normThirdPartyEntityId } from "@/lib/eo-video/thirdPartyEntityId";
import { fetchMapGisEoMenuContext, type MapGisEoMenuContext } from "@/lib/map-gis-eo-menu-context";

/** 与地图右键「选择光电…」子菜单同源的一行 */
export type MapGisCameraMenuRow = {
  entityId: string;
  label: string;
  /** 实体快照 PTZ 主相机（光电） */
  kind: "opto" | "thirdParty";
};

function cameraMenuLabel(
  entityId: string,
  fallback: string,
  eoCtx: MapGisEoMenuContext | null,
): string {
  const id = canonicalEntityId(entityId.trim());
  const fromEo = eoCtx?.cameraLabelByEntityId.get(id);
  if (fromEo?.trim()) return fromEo.trim();
  const fb = String(fallback ?? "").trim();
  return fb || id;
}

/**
 * 合并「光电」PTZ 主相机（实体快照 `hasPtz` + 无 parent）与「第三方相机」（8090 ontology）。
 * 与 `MapGisContextMenu` 中 `cameras` 列表一致。
 */
export function buildMapGisCameraMenuRows(
  ptzOwners: ReadonlyArray<EntityTaskRow>,
  eoCtx: MapGisEoMenuContext | null,
): MapGisCameraMenuRow[] {
  const seen = new Set<string>();
  const out: MapGisCameraMenuRow[] = [];

  for (const r of ptzOwners) {
    const id = canonicalEntityId(String(r.entityId ?? "").trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      entityId: id,
      label: cameraMenuLabel(id, r.label, eoCtx),
      kind: "opto",
    });
  }

  for (const tp of eoCtx?.thirdPartyCameras ?? []) {
    const id = normThirdPartyEntityId(String(tp.entityId ?? "").trim());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      entityId: id,
      label: cameraMenuLabel(id, String(tp.label ?? ""), eoCtx),
      kind: "thirdParty",
    });
  }

  return out.sort((a, b) => a.entityId.localeCompare(b.entityId, undefined, { numeric: true }));
}

/** 预拉实体快照 + eo 注册表/第三方相机，返回右键同源菜单行 */
export async function fetchMapGisCameraMenuRows(): Promise<MapGisCameraMenuRow[]> {
  await ensureEntitiesTrackTaskCache();
  const eoCtx = await fetchMapGisEoMenuContext();
  return buildMapGisCameraMenuRows(listTrackTaskOwnerRows(), eoCtx);
}

/** 图层面板「光电装备」子树：PTZ 主相机 + 8090 第三方相机（与右键「选择光电」同源） */
export async function fetchOptoLayerPanelCameraRows(): Promise<MapGisCameraMenuRow[]> {
  return fetchMapGisCameraMenuRows();
}

/** 仅第三方相机行（调试用或分组展示；面板用合并列表即可） */
export function thirdPartyRowsFromEoContext(
  eoCtx: MapGisEoMenuContext | null,
): ReadonlyArray<EoCameraRegistryRow> {
  return eoCtx?.thirdPartyCameras ?? [];
}
